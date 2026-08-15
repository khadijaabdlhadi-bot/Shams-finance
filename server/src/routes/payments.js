import { Router } from 'express';
import { one, many, tx } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import v from '../lib/validate.js';
import { getSettings } from './settings.js';
import { recordPayment, voidPayment } from '../services/payments.js';
import { studentProfile } from '../services/students.js';

const r = Router();
r.use(requireAuth);

/* ---------------- قائمة الدفعات ---------------- */

r.get('/', requirePermission('payments.view'), wrap(async (req, res) => {
  const { page, size, offset } = v.pagination(req.query);
  const params = [];
  const where = [];

  const push = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (req.query.status && req.query.status !== 'all') push('p.status = ?', req.query.status);
  if (req.query.method_id) push('p.method_id = ?', v.intId(req.query.method_id, 'طريقة الدفع'));
  if (req.query.user_id) push('p.created_by = ?', v.intId(req.query.user_id, 'الموظف'));
  if (req.query.year_id) push('e.academic_year_id = ?', v.intId(req.query.year_id, 'السنة'));
  if (req.query.class_id) push('e.class_id = ?', v.intId(req.query.class_id, 'الصف'));
  if (req.query.from) push('p.paid_at >= ?::date', String(req.query.from).slice(0, 10));
  if (req.query.to) push("p.paid_at < (?::date + interval '1 day')", String(req.query.to).slice(0, 10));
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(p.receipt_number ILIKE ${p} OR s.full_name ILIKE ${p} OR s.national_id LIKE ${p} OR s.student_number ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM payments p
    JOIN students s ON s.id = p.student_id
    JOIN student_enrollments e ON e.id = p.enrollment_id
    JOIN payment_methods m ON m.id = p.method_id
    JOIN users u ON u.id = p.created_by ${whereSql}`;

  const totals = await one(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN p.status='active' THEN p.amount ELSE 0 END),0)::numeric(14,2) AS total
     ${base}`, params
  );

  params.push(size, offset);
  const rows = await many(
    `SELECT p.id, p.receipt_number, p.amount, p.status, p.paid_at, p.notes, p.void_reason,
            s.id AS student_id, s.full_name, s.national_id, s.student_number,
            m.name_ar AS method_name, u.full_name AS cashier
     ${base} ORDER BY p.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ rows, total: totals.count, sum: totals.total, page, size, pages: Math.max(1, Math.ceil(totals.count / size)) });
}));

/** ملخّص قبل الدفع على قسط بعينه — يعرضه النظام في نافذة التأكيد */
r.get('/prepare-installment/:installmentId', requirePermission('payments.create'), wrap(async (req, res) => {
  const instId = v.intId(req.params.installmentId, 'القسط');
  const row = await one(
    `SELECT st.*, e.id AS enrollment_id, s.id AS student_id, s.full_name, s.national_id, s.student_number,
            c.name_ar AS class_name, b.total_due, b.total_paid, b.balance
     FROM installment_status st
     JOIN student_enrollments e ON e.id = st.enrollment_id
     JOIN students s ON s.id = e.student_id
     LEFT JOIN classes c ON c.id = e.class_id
     JOIN enrollment_balances b ON b.enrollment_id = e.id
     WHERE st.installment_id = $1`,
    [instId]
  );
  if (!row) throw notFound('القسط غير موجود.');
  const methods = await many('SELECT * FROM payment_methods WHERE active ORDER BY sort_order');
  res.json({ installment: row, methods });
}));

/* ---------------- شاشة تسجيل الدفعة ---------------- */

/** ملخص ما قبل الدفع: المستحق، المدفوع سابقًا، المتبقي، والبنود */
r.get('/prepare/:studentId', requirePermission('payments.create'), wrap(async (req, res) => {
  const studentId = v.intId(req.params.studentId, 'الطالب');
  const yearId = v.intId(req.query.year_id, 'السنة', { required: false });
  const profile = await studentProfile(studentId, yearId);
  if (!profile.enrollment) throw badRequest('الطالب غير مسجل في سنة دراسية.');
  const methods = await many('SELECT * FROM payment_methods WHERE active ORDER BY sort_order');
  res.json({
    student: profile.student,
    enrollment: profile.enrollment,
    balance: profile.balance,
    fees: profile.fees,
    installments: profile.installments,
    methods
  });
}));

/* ---------------- تسجيل دفعة ---------------- */

r.post('/', requirePermission('payments.create'), wrap(async (req, res) => {
  const b = req.body || {};
  const settings = await getSettings();

  const studentId = v.intId(b.student_id, 'الطالب', { required: false });
  let enrollmentId = v.intId(b.enrollment_id, 'التسجيل', { required: false });

  if (!enrollmentId) {
    if (!studentId) throw badRequest('يجب تحديد الطالب.');
    const yearId = v.intId(b.academic_year_id, 'السنة', { required: false });
    const e = await one(
      `SELECT e.id FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id
       WHERE e.student_id = $1 AND ($2::int IS NULL OR e.academic_year_id = $2)
       ORDER BY y.is_current DESC, y.name DESC LIMIT 1`,
      [studentId, yearId || null]
    );
    if (!e) throw badRequest('الطالب غير مسجل في أي سنة دراسية.');
    enrollmentId = e.id;
  }

  const amount = v.amount(b.amount, 'قيمة الدفعة', { allowZero: false });
  const methodId = v.intId(b.method_id, 'طريقة الدفع');
  const notes = v.optString(b.notes, { max: 500 });

  // دفعة على قسط بعينه: نبني التوزيع تلقائيًا، والتحقق من متبقي القسط يتم داخل المعاملة
  let allocations = Array.isArray(b.allocations) ? b.allocations : null;
  const installmentId = v.intId(b.installment_id, 'القسط', { required: false });
  if (installmentId && !allocations) {
    allocations = [{ installment_id: installmentId, amount }];
  }

  const out = await tx((c) => recordPayment(c, req, {
    enrollmentId, amount, methodId, notes, allocations, settings
  }));

  const profile = await studentProfile(out.payment.student_id);
  res.status(201).json({
    ok: true,
    message: `تم تسجيل الدفعة بنجاح وإنشاء الإيصال ${out.payment.receipt_number}`,
    payment: out.payment,
    receipt_number: out.payment.receipt_number,
    receipt_id: out.receipt.id,
    snapshot: out.snapshot,
    balance: profile.balance
  });
}));

/* ---------------- إلغاء دفعة ---------------- */

r.post('/:id/void', requirePermission('payments.void'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الدفعة');
  const reason = v.reqString(req.body?.reason, 'سبب الإلغاء', { max: 300, min: 3 });
  const payment = await tx((c) => voidPayment(c, req, id, reason));
  const profile = await studentProfile(payment.student_id);
  res.json({
    ok: true,
    message: `تم إلغاء الدفعة والإيصال ${payment.receipt_number}. أُعيد حساب رصيد الطالب.`,
    balance: profile.balance
  });
}));

r.get('/:id', requirePermission('payments.view'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الدفعة');
  const row = await one(
    `SELECT p.*, s.full_name, s.national_id, s.student_number, m.name_ar AS method_name,
            u.full_name AS cashier, vu.full_name AS voided_by_name, rc.id AS receipt_id
     FROM payments p
     JOIN students s ON s.id = p.student_id
     JOIN payment_methods m ON m.id = p.method_id
     JOIN users u ON u.id = p.created_by
     LEFT JOIN users vu ON vu.id = p.voided_by
     LEFT JOIN receipts rc ON rc.payment_id = p.id
     WHERE p.id = $1`,
    [id]
  );
  if (!row) throw notFound('الدفعة غير موجودة.');
  const allocations = await many(
    `SELECT a.amount, COALESCE(t.name_ar, i.name_ar) AS label
     FROM payment_allocations a
     LEFT JOIN student_fees f ON f.id = a.student_fee_id
     LEFT JOIN fee_types t ON t.id = f.fee_type_id
     LEFT JOIN installments i ON i.id = a.installment_id
     WHERE a.payment_id = $1`,
    [id]
  );
  res.json({ ...row, allocations });
}));

export default r;
