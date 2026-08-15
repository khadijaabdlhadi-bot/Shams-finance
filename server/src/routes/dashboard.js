import { Router } from 'express';
import { one, many } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { badRequest } from '../lib/errors.js';
import v from '../lib/validate.js';

const r = Router();
r.use(requireAuth);

const year = async (id) => {
  const row = id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [id])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!row) throw badRequest('لا توجد سنة دراسية محددة.');
  return row;
};

r.get('/', wrap(async (req, res) => {
  const y = await year(v.intId(req.query.year_id, 'السنة', { required: false }));

  const [totals, byFee, statuses, today, month, methods, monthly, recent] = await Promise.all([
    one(
      `SELECT COUNT(*)::int AS students,
              COALESCE(SUM(b.total_due),0)::numeric(14,2)   AS total_due,
              COALESCE(SUM(b.total_paid),0)::numeric(14,2)  AS total_paid,
              COALESCE(SUM(b.balance),0)::numeric(14,2)     AS balance,
              COALESCE(SUM(b.total_discount),0)::numeric(14,2) AS total_discount
       FROM enrollment_balances b
       JOIN student_enrollments e ON e.id = b.enrollment_id
       JOIN students s ON s.id = e.student_id
       WHERE b.academic_year_id = $1 AND s.status = 'active'`,
      [y.id]
    ),
    many(
      `SELECT t.code, t.name_ar,
              COALESCE(SUM(CASE WHEN f.required THEN f.amount - f.discount ELSE 0 END),0)::numeric(14,2) AS due,
              COALESCE(SUM(fp.paid),0)::numeric(14,2) AS paid
       FROM student_fees f
       JOIN fee_types t ON t.id = f.fee_type_id
       JOIN fee_paid fp ON fp.student_fee_id = f.id
       JOIN student_enrollments e ON e.id = f.enrollment_id
       JOIN students s ON s.id = e.student_id AND s.status = 'active'
       WHERE e.academic_year_id = $1
       GROUP BY t.id ORDER BY t.sort_order`,
      [y.id]
    ),
    one(
      `SELECT COUNT(*) FILTER (WHERE b.payment_status='paid')::int AS paid,
              COUNT(*) FILTER (WHERE b.payment_status='partial')::int AS partial,
              COUNT(*) FILTER (WHERE b.payment_status='unpaid')::int AS unpaid
       FROM enrollment_balances b
       JOIN student_enrollments e ON e.id = b.enrollment_id
       JOIN students s ON s.id = e.student_id AND s.status='active'
       WHERE b.academic_year_id = $1`,
      [y.id]
    ),
    one(
      `SELECT COALESCE(SUM(p.amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
       FROM payments p JOIN student_enrollments e ON e.id = p.enrollment_id
       WHERE p.status='active' AND e.academic_year_id = $1 AND p.paid_at::date = current_date`,
      [y.id]
    ),
    one(
      `SELECT COALESCE(SUM(p.amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count
       FROM payments p JOIN student_enrollments e ON e.id = p.enrollment_id
       WHERE p.status='active' AND e.academic_year_id = $1
         AND date_trunc('month', p.paid_at) = date_trunc('month', current_date)`,
      [y.id]
    ),
    many(
      `SELECT m.name_ar AS label, COALESCE(SUM(p.amount),0)::numeric(14,2) AS value, COUNT(*)::int AS count
       FROM payment_methods m
       LEFT JOIN payments p ON p.method_id = m.id AND p.status='active'
       LEFT JOIN student_enrollments e ON e.id = p.enrollment_id AND e.academic_year_id = $1
       WHERE m.active GROUP BY m.id ORDER BY m.sort_order`,
      [y.id]
    ),
    many(
      `SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month,
              COALESCE(SUM(p.amount),0)::numeric(14,2) AS value
       FROM payments p JOIN student_enrollments e ON e.id = p.enrollment_id
       WHERE p.status='active' AND e.academic_year_id = $1
         AND p.paid_at >= current_date - interval '11 months'
       GROUP BY 1 ORDER BY 1`,
      [y.id]
    ),
    many(
      `SELECT p.id, p.receipt_number, p.amount, p.paid_at, s.full_name, s.id AS student_id,
              m.name_ar AS method_name, u.full_name AS cashier
       FROM payments p JOIN students s ON s.id = p.student_id
       JOIN payment_methods m ON m.id = p.method_id JOIN users u ON u.id = p.created_by
       WHERE p.status='active' ORDER BY p.id DESC LIMIT 8`
    )
  ]);

  res.json({
    year: y,
    totals,
    fees: byFee,
    statuses,
    today,
    month,
    charts: {
      paid_vs_balance: [
        { label: 'المحصّل', value: totals.total_paid },
        { label: 'المتبقي', value: totals.balance }
      ],
      methods,
      monthly,
      statuses: [
        { label: 'مسدد بالكامل', value: statuses.paid },
        { label: 'مسدد جزئيًا', value: statuses.partial },
        { label: 'غير مسدد', value: statuses.unpaid }
      ]
    },
    recent_payments: recent
  });
}));

export default r;
