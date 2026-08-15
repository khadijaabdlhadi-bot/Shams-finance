import ExcelJS from 'exceljs';
import { many, one } from '../db.js';

/**
 * تصدير الطلاب الموجودين فعليًا في قاعدة البيانات إلى Excel.
 *
 * ملاحظات مهمة:
 * - البيانات تُقرأ من القاعدة مباشرة (لا Template فارغ ولا بيانات وهمية).
 * - الرقم الوطني والهواتف وأرقام الطلاب تُكتب **نصًا** (numFmt '@') حتى لا يحذف Excel
 *   الأصفار في البداية.
 * - المبالغ أرقام حقيقية بصيغة #,##0.00 ليصح الجمع داخل Excel.
 */

export const EXPORT_COLUMNS = [
  { key: 'student_number', label: 'رقم الطالب', width: 18, text: true },
  { key: 'national_id', label: 'الرقم الوطني', width: 20, text: true },
  { key: 'full_name', label: 'اسم الطالب', width: 28 },
  { key: 'guardian_phone', label: 'هاتف ولي الأمر', width: 18, text: true },
  { key: 'extra_phone', label: 'الهاتف الإضافي', width: 18, text: true },
  { key: 'class_name', label: 'الصف', width: 14 },
  { key: 'section_name', label: 'الفصل', width: 10 },
  { key: 'year_name', label: 'السنة الدراسية', width: 15 },
  { key: 'tuition_fee', label: 'الرسوم الدراسية', width: 16, money: true },
  { key: 'registration_fee', label: 'رسوم التسجيل', width: 15, money: true },
  { key: 'uniform_fee', label: 'رسوم الزي', width: 14, money: true },
  { key: 'extra_fee', label: 'الرسوم الإضافية', width: 15, money: true },
  { key: 'discount', label: 'الخصم', width: 12, money: true },
  { key: 'total_due', label: 'إجمالي المستحق', width: 16, money: true },
  { key: 'total_paid', label: 'إجمالي المدفوع', width: 16, money: true },
  { key: 'balance', label: 'إجمالي المتبقي', width: 16, money: true },
  { key: 'payment_status_ar', label: 'حالة الدفع', width: 15 },
  { key: 'installments_count', label: 'عدد الأقساط', width: 12 },
  { key: 'last_payment_at', label: 'آخر دفعة', width: 18 },
  { key: 'notes', label: 'ملاحظات', width: 26 }
];

const STATUS_AR = { paid: 'مسدد بالكامل', partial: 'مسدد جزئيًا', unpaid: 'غير مسدد' };

/**
 * جلب الطلاب مع كل أرقامهم المالية — نفس فلاتر شاشة الطلاب بالضبط،
 * حتى يكون «تصدير النتائج الحالية» مطابقًا لما يراه المستخدم على الشاشة.
 */
export async function fetchStudentsForExport({
  yearId, search = null, status = 'active', paymentStatus = 'all', classId = null, sectionId = null,
  onlyBalance = false, limit = 10000
} = {}) {
  const params = [yearId];
  const where = [];

  if (status === 'archived') where.push(`s.status = 'archived'`);
  else if (status === 'all') { /* الكل */ }
  else where.push(`s.status = 'active'`);

  if (paymentStatus && paymentStatus !== 'all') {
    params.push(paymentStatus);
    where.push(`b.payment_status = $${params.length}`);
  }
  if (classId) { params.push(classId); where.push(`e.class_id = $${params.length}`); }
  if (sectionId) { params.push(sectionId); where.push(`e.section_id = $${params.length}`); }
  if (onlyBalance) where.push('b.balance > 0');
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(s.national_id LIKE ${p} OR s.student_number ILIKE ${p} OR s.full_name ILIKE ${p}
                 OR s.guardian_phone LIKE ${p} OR s.extra_phone LIKE ${p})`);
  }

  params.push(limit);

  return many(
    `SELECT s.student_number, s.national_id, s.full_name, s.guardian_phone, s.extra_phone, s.notes,
            c.name_ar  AS class_name,
            sec.name_ar AS section_name,
            y.name      AS year_name,
            COALESCE(MAX(f.amount)    FILTER (WHERE t.code = 'tuition'), 0)::numeric(14,2)      AS tuition_fee,
            COALESCE(MAX(f.amount)    FILTER (WHERE t.code = 'registration'), 0)::numeric(14,2) AS registration_fee,
            COALESCE(MAX(CASE WHEN t.code = 'uniform' AND f.required THEN f.amount ELSE 0 END), 0)::numeric(14,2) AS uniform_fee,
            COALESCE(MAX(f.amount)    FILTER (WHERE t.code = 'extra'), 0)::numeric(14,2)        AS extra_fee,
            COALESCE(SUM(f.discount), 0)::numeric(14,2)                                          AS discount,
            b.total_due, b.total_paid, b.balance, b.payment_status,
            (SELECT COUNT(*)::int FROM installments i WHERE i.enrollment_id = e.id)              AS installments_count,
            (SELECT MAX(p.paid_at) FROM payments p WHERE p.enrollment_id = e.id AND p.status = 'active') AS last_payment_at
     FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     JOIN academic_years y      ON y.id = e.academic_year_id
     JOIN enrollment_balances b ON b.enrollment_id = e.id
     LEFT JOIN classes c        ON c.id = e.class_id
     LEFT JOIN sections sec     ON sec.id = e.section_id
     LEFT JOIN student_fees f   ON f.enrollment_id = e.id
     LEFT JOIN fee_types t      ON t.id = f.fee_type_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY s.id, e.id, c.name_ar, sec.name_ar, y.name,
              b.total_due, b.total_paid, b.balance, b.payment_status
     ORDER BY c.name_ar NULLS LAST, s.full_name
     LIMIT $${params.length}`,
    params
  );
}

/** بناء ملف Excel من صفوف الطلاب. */
export async function buildStudentsWorkbook(rows, { settings = {}, title = 'بيانات الطلاب', filters = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.school_name || 'المنظومة المالية';
  wb.created = new Date();

  const ws = wb.addWorksheet('الطلاب', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
  const lastCol = EXPORT_COLUMNS.length;

  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${settings.school_name || 'مدرسة شمس الوطن'} — ${title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value =
    `عدد الطلاب: ${rows.length}${filters.length ? ' · الفلاتر: ' + filters.join(' · ') : ''}`
    + ` · تاريخ التصدير: ${new Date().toLocaleString('en-GB')}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF5B6B7C' } };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };

  ws.addRow(EXPORT_COLUMNS.map((c) => c.label));
  const header = ws.getRow(3);
  header.font = { bold: true };
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FB' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB9CBDD' } } };
  });

  for (const row of rows) {
    ws.addRow(EXPORT_COLUMNS.map((c) => {
      const v = row[c.key];
      if (c.key === 'payment_status_ar') return STATUS_AR[row.payment_status] || row.payment_status || '';
      if (v === null || v === undefined) return '';
      if (c.text) return String(v);                     // نص: تبقى الأصفار في البداية
      if (c.money) return Number(v);                    // رقم: يصح الجمع في Excel
      if (c.key === 'last_payment_at') return new Date(v).toLocaleString('en-GB');
      return v;
    }));
  }

  EXPORT_COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.text) col.numFmt = '@';
    if (c.money) col.numFmt = '#,##0.00';
  });

  // صف الإجماليات
  if (rows.length) {
    const totalRow = ws.addRow([]);
    totalRow.getCell(1).value = 'الإجمالي';
    totalRow.font = { bold: true };
    const sum = (key) => rows.reduce((a, r) => a + Math.round(Number(r[key] || 0) * 100), 0) / 100;
    for (const key of ['tuition_fee', 'registration_fee', 'uniform_fee', 'extra_fee', 'discount', 'total_due', 'total_paid', 'balance']) {
      const idx = EXPORT_COLUMNS.findIndex((c) => c.key === key) + 1;
      totalRow.getCell(idx).value = sum(key);
      totalRow.getCell(idx).numFmt = '#,##0.00';
    }
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FC' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FFB9CBDD' } } };
    });
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: lastCol } };
  return wb;
}

/** ورقة ثانية: كل الأقساط لمن لديه أقساط — مفيدة للمحاسب */
export async function appendInstallmentsSheet(wb, yearId) {
  const rows = await many(
    `SELECT s.student_number, s.national_id, s.full_name, c.name_ar AS class_name,
            st.name_ar, st.amount, st.paid, st.remaining, st.due_date, st.status
     FROM installment_status st
     JOIN student_enrollments e ON e.id = st.enrollment_id AND e.academic_year_id = $1
     JOIN students s ON s.id = e.student_id
     LEFT JOIN classes c ON c.id = e.class_id
     ORDER BY s.full_name, st.sort_order`,
    [yearId]
  );
  if (!rows.length) return wb;

  const AR = { paid: 'مدفوع بالكامل', partial: 'مدفوع جزئيًا', unpaid: 'غير مدفوع', late: 'متأخر', due: 'مستحق' };
  const ws = wb.addWorksheet('الأقساط', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.addRow(['رقم الطالب', 'الرقم الوطني', 'اسم الطالب', 'الصف', 'القسط', 'قيمة القسط', 'المدفوع', 'المتبقي', 'تاريخ الاستحقاق', 'الحالة']);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      String(r.student_number), String(r.national_id), r.full_name, r.class_name || '',
      r.name_ar, Number(r.amount), Number(r.paid), Number(r.remaining),
      r.due_date ? new Date(r.due_date).toLocaleDateString('en-GB') : '', AR[r.status] || r.status
    ]);
  }
  [1, 2].forEach((i) => { ws.getColumn(i).numFmt = '@'; ws.getColumn(i).width = 18; });
  [6, 7, 8].forEach((i) => { ws.getColumn(i).numFmt = '#,##0.00'; ws.getColumn(i).width = 14; });
  ws.getColumn(3).width = 26; ws.getColumn(5).width = 20; ws.getColumn(9).width = 16; ws.getColumn(10).width = 15;
  return wb;
}

export default { fetchStudentsForExport, buildStudentsWorkbook, appendInstallmentsSheet, EXPORT_COLUMNS };
