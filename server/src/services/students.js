import { one, many } from '../db.js';
import { nextStudentNumber } from '../lib/ids.js';
import { notFound, badRequest } from '../lib/errors.js';

/** السنة الدراسية المطلوبة، أو الحالية إن لم تُحدَّد. */
export async function resolveYear(client, yearId) {
  const runner = client || { query: (t, p) => one(t, p).then((row) => ({ rows: row ? [row] : [] })) };
  if (yearId) {
    const { rows } = await runner.query('SELECT * FROM academic_years WHERE id = $1', [yearId]);
    if (!rows.length) throw badRequest('السنة الدراسية غير موجودة.');
    return rows[0];
  }
  const { rows } = await runner.query('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!rows.length) throw badRequest('لا توجد سنة دراسية حالية. حدّدها من الإعدادات أولًا.');
  return rows[0];
}

/**
 * إنشاء طالب + تسجيله في السنة + رسومه — كل ذلك في معاملة واحدة.
 * رقم الطالب يُولَّد ذريًا، والرقم الوطني يحميه قيد UNIQUE في القاعدة.
 */
export async function createStudent(client, req, data) {
  const {
    national_id, full_name, guardian_name, guardian_phone, extra_phone, notes,
    year, class_id, section_id, fees = [], studentPrefix = 'STU'
  } = data;

  const yearNumber = Number(String(year.name).slice(0, 4)) || new Date().getFullYear();
  const studentNumber = await nextStudentNumber(client, yearNumber, studentPrefix);

  const { rows: [student] } = await client.query(
    `INSERT INTO students
       (student_number, national_id, full_name, guardian_name, guardian_phone, extra_phone, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
    [studentNumber, national_id, full_name, guardian_name, guardian_phone, extra_phone, notes, req.user.id]
  );

  const { rows: [enrollment] } = await client.query(
    `INSERT INTO student_enrollments (student_id, academic_year_id, class_id, section_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
    [student.id, year.id, class_id || null, section_id || null, req.user.id]
  );

  await saveFees(client, req, enrollment.id, fees);
  return { student, enrollment };
}

/** حفظ/تحديث بنود رسوم التسجيل. */
export async function saveFees(client, req, enrollmentId, fees) {
  for (const f of fees) {
    await client.query(
      `INSERT INTO student_fees (enrollment_id, fee_type_id, amount, discount, required, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (enrollment_id, fee_type_id) DO UPDATE
         SET amount = EXCLUDED.amount, discount = EXCLUDED.discount, required = EXCLUDED.required,
             notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [enrollmentId, f.fee_type_id, f.amount, f.discount || '0.00', f.required !== false, f.notes || null, req.user.id]
    );
  }
}

const LIST_SELECT = `
  SELECT s.id, s.student_number, s.national_id, s.full_name, s.guardian_name,
         s.guardian_phone, s.extra_phone, s.status, s.created_at,
         e.id AS enrollment_id, e.academic_year_id,
         c.name_ar AS class_name, sec.name_ar AS section_name,
         b.total_due, b.total_paid, b.balance, b.payment_status, b.total_discount
  FROM students s
  JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
  LEFT JOIN classes c   ON c.id = e.class_id
  LEFT JOIN sections sec ON sec.id = e.section_id
  JOIN enrollment_balances b ON b.enrollment_id = e.id`;

/** بحث + ترقيم من الخادم. البحث بالرقم الوطني ورقم الطالب والاسم والهواتف. */
export async function listStudents({ yearId, search, status, paymentStatus, classId, sectionId, page, size, offset }) {
  const params = [yearId];
  const where = [];

  if (status === 'archived') where.push(`s.status = 'archived'`);
  else if (status === 'all') { /* بلا شرط */ }
  else where.push(`s.status = 'active'`);

  if (paymentStatus && paymentStatus !== 'all') {
    params.push(paymentStatus);
    where.push(`b.payment_status = $${params.length}`);
  }
  if (classId) { params.push(classId); where.push(`e.class_id = $${params.length}`); }
  if (sectionId) { params.push(sectionId); where.push(`e.section_id = $${params.length}`); }

  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(s.national_id LIKE ${p} OR s.student_number ILIKE ${p} OR s.full_name ILIKE ${p}
                 OR s.guardian_phone LIKE ${p} OR s.extra_phone LIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await one(
    `SELECT COUNT(*)::int AS total FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     JOIN enrollment_balances b ON b.enrollment_id = e.id ${whereSql}`,
    params
  );

  params.push(size, offset);
  const rows = await many(
    `${LIST_SELECT} ${whereSql} ORDER BY s.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows, total: countRow.total, page, size, pages: Math.max(1, Math.ceil(countRow.total / size)) };
}

/** أعداد التبويبات: الكل / مسدد / جزئي / غير مسدد */
export async function statusCounts(yearId) {
  const row = await one(
    `SELECT COUNT(*)::int AS all,
            COUNT(*) FILTER (WHERE b.payment_status = 'paid')::int AS paid,
            COUNT(*) FILTER (WHERE b.payment_status = 'partial')::int AS partial,
            COUNT(*) FILTER (WHERE b.payment_status = 'unpaid')::int AS unpaid
     FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     JOIN enrollment_balances b ON b.enrollment_id = e.id
     WHERE s.status = 'active'`,
    [yearId]
  );
  return row;
}

/** ملف الطالب الكامل. */
export async function studentProfile(studentId, yearId) {
  const student = await one('SELECT * FROM students WHERE id = $1', [studentId]);
  if (!student) throw notFound('الطالب غير موجود.');

  const enrollment = await one(
    `SELECT e.*, y.name AS year_name, c.name_ar AS class_name, sec.name_ar AS section_name
     FROM student_enrollments e
     JOIN academic_years y ON y.id = e.academic_year_id
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     WHERE e.student_id = $1 AND ($2::int IS NULL OR e.academic_year_id = $2)
     ORDER BY y.name DESC LIMIT 1`,
    [studentId, yearId || null]
  );
  if (!enrollment) return { student, enrollment: null, fees: [], payments: [], installments: [], balance: null };

  const [fees, payments, installments, balance, years] = await Promise.all([
    many(
      `SELECT f.*, t.code AS fee_code, t.name_ar AS fee_name, t.optional, fp.paid,
              (f.amount - f.discount)::numeric(14,2) AS net,
              (f.amount - f.discount - fp.paid)::numeric(14,2) AS remaining
       FROM student_fees f
       JOIN fee_types t ON t.id = f.fee_type_id
       JOIN fee_paid fp ON fp.student_fee_id = f.id
       WHERE f.enrollment_id = $1 ORDER BY t.sort_order`,
      [enrollment.id]
    ),
    many(
      `SELECT p.*, m.name_ar AS method_name, m.code AS method_code,
              u.full_name AS created_by_name, v.full_name AS voided_by_name
       FROM payments p
       JOIN payment_methods m ON m.id = p.method_id
       JOIN users u ON u.id = p.created_by
       LEFT JOIN users v ON v.id = p.voided_by
       WHERE p.enrollment_id = $1 ORDER BY p.id DESC`,
      [enrollment.id]
    ),
    many(
      `SELECT st.*, i.id, i.created_at,
              (SELECT COUNT(*)::int FROM payment_allocations a
                 JOIN payments p ON p.id = a.payment_id
               WHERE a.installment_id = i.id AND p.status = 'active') AS payments_count
       FROM installment_status st JOIN installments i ON i.id = st.installment_id
       WHERE st.enrollment_id = $1 ORDER BY st.sort_order, st.due_date`,
      [enrollment.id]
    ),
    one('SELECT * FROM enrollment_balances WHERE enrollment_id = $1', [enrollment.id]),
    many(
      `SELECT e.id AS enrollment_id, y.id AS year_id, y.name AS year_name, b.total_due, b.total_paid, b.balance, b.payment_status
       FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id
       JOIN enrollment_balances b ON b.enrollment_id = e.id
       WHERE e.student_id = $1 ORDER BY y.name DESC`,
      [studentId]
    )
  ]);

  return { student, enrollment, fees, payments, installments, balance, years };
}

export default { createStudent, saveFees, listStudents, statusCounts, studentProfile, resolveYear };
