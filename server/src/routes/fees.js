import { Router } from 'express';
import { one, many } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { badRequest } from '../lib/errors.js';
import v from '../lib/validate.js';

const r = Router();
r.use(requireAuth, requirePermission('fees.view'));

const yearOf = async (id) => {
  const row = id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [id])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!row) throw badRequest('لا توجد سنة دراسية محددة.');
  return row;
};

/**
 * شاشة بند واحد من الرسوم (رسوم التسجيل / الزي / أي بند آخر):
 * لكل طالب: القيمة، المدفوع، المتبقي، والحالة.
 */
r.get('/summary/:code', wrap(async (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);

  const type = await one('SELECT * FROM fee_types WHERE code = $1', [code]);
  if (!type) throw badRequest('نوع الرسوم غير معروف.');

  const params = [year.id, type.id];
  const where = [`s.status = 'active'`];
  if (req.query.status === 'paid') where.push(`(f.amount - f.discount - fp.paid) <= 0 AND f.required`);
  if (req.query.status === 'partial') where.push(`fp.paid > 0 AND (f.amount - f.discount - fp.paid) > 0`);
  if (req.query.status === 'unpaid') where.push(`fp.paid = 0 AND f.required AND (f.amount - f.discount) > 0`);
  if (req.query.status === 'not_required') where.push(`f.required = FALSE`);
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(s.full_name ILIKE ${p} OR s.national_id LIKE ${p} OR s.student_number ILIKE ${p})`);
  }

  const base = `FROM student_fees f
    JOIN fee_paid fp ON fp.student_fee_id = f.id
    JOIN student_enrollments e ON e.id = f.enrollment_id AND e.academic_year_id = $1
    JOIN students s ON s.id = e.student_id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE f.fee_type_id = $2 AND ${where.join(' AND ')}`;

  const totals = await one(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN f.required THEN f.amount - f.discount ELSE 0 END),0)::numeric(14,2) AS due,
            COALESCE(SUM(fp.paid),0)::numeric(14,2) AS paid
     ${base}`, params
  );

  params.push(size, offset);
  const rows = await many(
    `SELECT s.id AS student_id, s.student_number, s.national_id, s.full_name, s.guardian_phone,
            c.name_ar AS class_name, f.amount, f.discount, f.required, fp.paid,
            (f.amount - f.discount)::numeric(14,2) AS net,
            (CASE WHEN f.required THEN f.amount - f.discount - fp.paid ELSE 0 END)::numeric(14,2) AS remaining,
            CASE WHEN NOT f.required THEN 'not_required'
                 WHEN fp.paid >= (f.amount - f.discount) THEN 'paid'
                 WHEN fp.paid > 0 THEN 'partial' ELSE 'unpaid' END AS status
     ${base} ORDER BY s.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    fee_type: type, year, rows,
    totals: { ...totals, remaining: (Number(totals.due) - Number(totals.paid)).toFixed(2) },
    page, size, pages: Math.max(1, Math.ceil(totals.count / size))
  });
}));

/** كل الأقساط عبر الطلاب مع حالتها (مستحق / متأخر / مدفوع…). */
r.get('/installments', wrap(async (req, res) => {
  const year = await yearOf(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);
  const params = [year.id];
  const where = [`s.status='active'`];
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(s.full_name ILIKE $${params.length} OR s.national_id LIKE $${params.length})`);
  }
  const base = `FROM installments i
    JOIN installment_paid ip ON ip.installment_id = i.id
    JOIN student_enrollments e ON e.id = i.enrollment_id AND e.academic_year_id = $1
    JOIN students s ON s.id = e.student_id
    WHERE ${where.join(' AND ')}`;

  const total = (await one(`SELECT COUNT(*)::int AS c ${base}`, params)).c;
  params.push(size, offset);
  const rows = await many(
    `SELECT i.id, i.name_ar, i.amount, i.due_date, ip.paid,
            (i.amount - ip.paid)::numeric(14,2) AS remaining,
            s.id AS student_id, s.full_name, s.national_id, s.student_number,
            CASE WHEN ip.paid >= i.amount THEN 'paid'
                 WHEN i.due_date IS NOT NULL AND i.due_date < current_date AND ip.paid < i.amount THEN 'late'
                 WHEN ip.paid > 0 THEN 'partial'
                 WHEN i.due_date IS NULL OR i.due_date > current_date THEN 'not_due'
                 ELSE 'due' END AS status
     ${base} ORDER BY i.due_date NULLS LAST, s.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)), year });
}));

export default r;
