import { Router } from 'express';
import { one, many } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { badRequest } from '../lib/errors.js';
import v from '../lib/validate.js';

/**
 * القسم المالي — كل ما يحتاجه المحاسب في مكان واحد:
 * الطلبة والمدفوعات · الأقساط · الخزينة · الديون · الخصومات.
 * كل الأرقام محسوبة من الجداول نفسها (لا حقول مخزّنة يمكن أن تنحرف).
 */
const r = Router();
r.use(requireAuth);

const yearOf = async (id) => {
  const row = id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [id])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!row) throw badRequest('لا توجد سنة دراسية محددة.');
  return row;
};

/* ================= لوحة القسم المالي ================= */

r.get('/overview', requirePermission('payments.view', 'fees.view'), wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));

  const [totals, statuses, today, installments, discounts, debts] = await Promise.all([
    one(
      `SELECT COUNT(*)::int AS students,
              COALESCE(SUM(b.total_due),0)::numeric(14,2)  AS total_due,
              COALESCE(SUM(b.total_paid),0)::numeric(14,2) AS total_paid,
              COALESCE(SUM(b.balance),0)::numeric(14,2)    AS balance
       FROM enrollment_balances b
       JOIN student_enrollments e ON e.id = b.enrollment_id
       JOIN students s ON s.id = e.student_id AND s.status = 'active'
       WHERE b.academic_year_id = $1`, [year.id]
    ),
    one(
      `SELECT COUNT(*) FILTER (WHERE b.payment_status='paid')::int    AS paid,
              COUNT(*) FILTER (WHERE b.payment_status='partial')::int AS partial,
              COUNT(*) FILTER (WHERE b.payment_status='unpaid')::int  AS unpaid
       FROM enrollment_balances b
       JOIN student_enrollments e ON e.id = b.enrollment_id
       JOIN students s ON s.id = e.student_id AND s.status='active'
       WHERE b.academic_year_id = $1`, [year.id]
    ),
    one(
      `SELECT COALESCE(SUM(p.amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
       FROM payments p JOIN student_enrollments e ON e.id = p.enrollment_id
       WHERE p.status='active' AND e.academic_year_id = $1 AND p.paid_at::date = current_date`, [year.id]
    ),
    one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE st.status = 'late')::int    AS late,
              COUNT(*) FILTER (WHERE st.status = 'paid')::int    AS paid,
              COALESCE(SUM(st.remaining),0)::numeric(14,2)       AS remaining
       FROM installment_status st
       JOIN student_enrollments e ON e.id = st.enrollment_id
       WHERE e.academic_year_id = $1`, [year.id]
    ),
    one(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(f.discount),0)::numeric(14,2) AS total
       FROM student_fees f JOIN student_enrollments e ON e.id = f.enrollment_id
       WHERE e.academic_year_id = $1 AND f.discount > 0`, [year.id]
    ),
    one(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(b.balance),0)::numeric(14,2) AS total
       FROM enrollment_balances b
       JOIN student_enrollments e ON e.id = b.enrollment_id
       JOIN students s ON s.id = e.student_id AND s.status='active'
       WHERE b.academic_year_id = $1 AND b.balance > 0`, [year.id]
    )
  ]);

  res.json({ year, totals, statuses, today, installments, discounts, debts });
}));

/* ================= الطلبة والمدفوعات ================= */

/** جدول سريع للمحاسب: أرقام الطالب + قسطه الحالي + آخر دفعة. */
r.get('/students', requirePermission('payments.view'), wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);

  const params = [year.id];
  const where = [`s.status = 'active'`];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (req.query.payment_status && req.query.payment_status !== 'all') add('b.payment_status = ?', String(req.query.payment_status));
  if (req.query.class_id) add('e.class_id = ?', v.intId(req.query.class_id, 'الصف'));
  if (req.query.section_id) add('e.section_id = ?', v.intId(req.query.section_id, 'الفصل'));
  if (req.query.only_debt === '1') where.push('b.balance > 0');
  if (req.query.late === '1') {
    where.push(`EXISTS (SELECT 1 FROM installment_status st WHERE st.enrollment_id = e.id AND st.status = 'late')`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(s.full_name ILIKE ${p} OR s.national_id LIKE ${p} OR s.student_number ILIKE ${p} OR s.guardian_phone LIKE ${p})`);
  }

  const base = `FROM students s
    JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
    JOIN enrollment_balances b ON b.enrollment_id = e.id
    LEFT JOIN classes c ON c.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    WHERE ${where.join(' AND ')}`;

  const totals = await one(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(b.total_due),0)::numeric(14,2)  AS total_due,
            COALESCE(SUM(b.total_paid),0)::numeric(14,2) AS total_paid,
            COALESCE(SUM(b.balance),0)::numeric(14,2)    AS balance ${base}`,
    params
  );

  params.push(size, offset);
  const rows = await many(
    `SELECT s.id, s.student_number, s.national_id, s.full_name, s.guardian_phone,
            c.name_ar AS class_name, sec.name_ar AS section_name,
            b.total_due, b.total_paid, b.balance, b.payment_status,
            (SELECT row_to_json(x) FROM (
               SELECT st.installment_id AS id, st.name_ar, st.amount, st.paid, st.remaining, st.due_date, st.status, st.percent
               FROM installment_status st
               WHERE st.enrollment_id = e.id AND st.status <> 'paid'
               ORDER BY CASE st.status WHEN 'late' THEN 0 WHEN 'due' THEN 1 ELSE 2 END,
                        st.due_date NULLS LAST, st.sort_order
               LIMIT 1) x) AS current_installment,
            (SELECT row_to_json(y) FROM (
               SELECT p.id, p.amount, p.paid_at, p.receipt_number, m.name_ar AS method_name
               FROM payments p JOIN payment_methods m ON m.id = p.method_id
               WHERE p.enrollment_id = e.id AND p.status = 'active'
               ORDER BY p.id DESC LIMIT 1) y) AS last_payment
     ${base} ORDER BY b.balance DESC, s.full_name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ rows, totals, total: totals.count, page, size, pages: Math.max(1, Math.ceil(totals.count / size)), year });
}));

/* ================= الأقساط عبر كل الطلاب ================= */

r.get('/installments', requirePermission('fees.view'), wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);

  const params = [year.id];
  const where = [`s.status = 'active'`];
  if (req.query.status && req.query.status !== 'all') {
    params.push(String(req.query.status));
    where.push(`st.status = $${params.length}`);
  }
  if (req.query.class_id) { params.push(v.intId(req.query.class_id, 'الصف')); where.push(`e.class_id = $${params.length}`); }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(s.full_name ILIKE ${p} OR s.national_id LIKE ${p} OR st.name_ar ILIKE ${p})`);
  }

  const base = `FROM installment_status st
    JOIN student_enrollments e ON e.id = st.enrollment_id AND e.academic_year_id = $1
    JOIN students s ON s.id = e.student_id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE ${where.join(' AND ')}`;

  const totals = await one(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(st.amount),0)::numeric(14,2)    AS amount,
            COALESCE(SUM(st.paid),0)::numeric(14,2)      AS paid,
            COALESCE(SUM(st.remaining),0)::numeric(14,2) AS remaining,
            COUNT(*) FILTER (WHERE st.status='late')::int AS late ${base}`,
    params
  );

  params.push(size, offset);
  const rows = await many(
    `SELECT st.installment_id, st.name_ar, st.amount, st.paid, st.remaining, st.due_date,
            st.status, st.percent, s.id AS student_id, s.full_name, s.national_id, s.student_number,
            c.name_ar AS class_name
     ${base} ORDER BY CASE st.status WHEN 'late' THEN 0 WHEN 'due' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END,
              st.due_date NULLS LAST, s.full_name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ rows, totals, total: totals.count, page, size, pages: Math.max(1, Math.ceil(totals.count / size)), year });
}));

/* ================= الخزينة ================= */

r.get('/treasury', requirePermission('payments.view'), wrap(async (req, res) => {
  const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

  const [balance, today, month, byMethod, byUser] = await Promise.all([
    one(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
         FROM payments WHERE status = 'active'`),
    one(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
         FROM payments WHERE status='active' AND paid_at::date = current_date`),
    one(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
         FROM payments WHERE status='active' AND date_trunc('month', paid_at) = date_trunc('month', current_date)`),
    many(
      `SELECT m.name_ar AS label, m.code,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status='active'),0)::numeric(14,2) AS value,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status='active' AND p.paid_at::date = current_date),0)::numeric(14,2) AS today,
              COUNT(p.id) FILTER (WHERE p.status='active')::int AS count
       FROM payment_methods m LEFT JOIN payments p ON p.method_id = m.id
       WHERE m.active GROUP BY m.id ORDER BY m.sort_order`
    ),
    many(
      `SELECT u.full_name AS label,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status='active' AND p.paid_at::date = current_date),0)::numeric(14,2) AS today,
              COUNT(p.id) FILTER (WHERE p.status='active' AND p.paid_at::date = current_date)::int AS count
       FROM users u JOIN payments p ON p.created_by = u.id
       GROUP BY u.id HAVING COUNT(p.id) FILTER (WHERE p.status='active' AND p.paid_at::date = current_date) > 0
       ORDER BY today DESC`
    )
  ]);

  const voided = await one(
    `SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
     FROM payments WHERE status='void'`
  );

  // الحركات: داخل (+) لكل دفعة، وخارج (−) لكل إلغاء
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`t.happened_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`t.happened_at < ($${params.length}::date + interval '1 day')`); }
  params.push(200);

  const movements = await many(
    `SELECT t.direction, t.amount, t.happened_at, t.receipt_number, t.kind, t.status,
            s.full_name AS student_name, s.id AS student_id,
            m.name_ar AS method_name, u.full_name AS user_name
     FROM treasury_movements t
     JOIN students s ON s.id = t.student_id
     JOIN payment_methods m ON m.id = t.method_id
     LEFT JOIN users u ON u.id = t.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.happened_at DESC NULLS LAST LIMIT $${params.length}`,
    params
  );

  res.json({
    balance, today, month, voided,
    by_method: byMethod,
    by_user: byUser,
    movements,
    note: 'رصيد الخزينة = مجموع الدفعات السارية. الدفعات الملغاة تظهر كحركة عكسية ولا تدخل في الرصيد.'
  });
}));

/* ================= الديون ================= */

r.get('/debts', requirePermission('payments.view'), wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);

  const params = [year.id];
  const where = [`s.status='active'`, 'b.balance > 0'];
  if (req.query.class_id) { params.push(v.intId(req.query.class_id, 'الصف')); where.push(`e.class_id = $${params.length}`); }
  if (req.query.late === '1') {
    where.push(`EXISTS (SELECT 1 FROM installment_status st WHERE st.enrollment_id = e.id AND st.status='late')`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(s.full_name ILIKE ${p} OR s.national_id LIKE ${p} OR s.guardian_phone LIKE ${p})`);
  }

  const base = `FROM students s
    JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
    JOIN enrollment_balances b ON b.enrollment_id = e.id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE ${where.join(' AND ')}`;

  const totals = await one(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(b.balance),0)::numeric(14,2) AS debt ${base}`, params
  );

  params.push(size, offset);
  const rows = await many(
    `SELECT s.id, s.student_number, s.national_id, s.full_name, s.guardian_phone,
            c.name_ar AS class_name, b.total_due, b.total_paid, b.balance, b.payment_status,
            (SELECT row_to_json(x) FROM (
               SELECT st.name_ar, st.remaining, st.due_date, st.status
               FROM installment_status st WHERE st.enrollment_id = e.id AND st.status = 'late'
               ORDER BY st.due_date LIMIT 1) x) AS late_installment
     ${base} ORDER BY b.balance DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ rows, totals, total: totals.count, page, size, pages: Math.max(1, Math.ceil(totals.count / size)), year });
}));

/* ================= الخصومات ================= */

r.get('/discounts', requirePermission('fees.view'), wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const rows = await many(
    `SELECT s.id AS student_id, s.student_number, s.national_id, s.full_name,
            c.name_ar AS class_name, t.name_ar AS fee_name,
            f.amount, f.discount, f.discount_reason, f.discount_at,
            u.full_name AS granted_by
     FROM student_fees f
     JOIN fee_types t ON t.id = f.fee_type_id
     JOIN student_enrollments e ON e.id = f.enrollment_id AND e.academic_year_id = $1
     JOIN students s ON s.id = e.student_id
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN users u ON u.id = f.discount_by
     WHERE f.discount > 0 ORDER BY f.discount DESC`,
    [year.id]
  );
  const total = rows.reduce((a, x) => a + Math.round(Number(x.discount) * 100), 0) / 100;
  res.json({ rows, total: total.toFixed(2), count: rows.length, year });
}));

export default r;
