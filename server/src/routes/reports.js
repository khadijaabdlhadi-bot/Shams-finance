import { Router } from 'express';
import ExcelJS from 'exceljs';
import { one, many } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { badRequest, AppError } from '../lib/errors.js';
import v from '../lib/validate.js';
import { getSettings } from './settings.js';
import { htmlToPdf, pdfAvailable } from '../services/pdf.js';

const r = Router();
r.use(requireAuth, requirePermission('reports.view'));

const yearOf = async (id) => {
  const row = id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [id])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!row) throw badRequest('لا توجد سنة دراسية محددة.');
  return row;
};

const dateOnly = (s) => (s ? String(s).slice(0, 10) : null);

/* ================= تقرير الطلاب ================= */

async function studentsReport(q) {
  const year = await yearOf(v.intId(q.year_id, 'السنة', { required: false }));
  const params = [year.id];
  const where = [`s.status = 'active'`];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (q.payment_status && q.payment_status !== 'all') add('b.payment_status = ?', String(q.payment_status));
  if (q.class_id) add('e.class_id = ?', v.intId(q.class_id, 'الصف'));
  if (q.section_id) add('e.section_id = ?', v.intId(q.section_id, 'الفصل'));
  if (q.only_balance === '1') where.push('b.balance > 0');

  const rows = await many(
    `SELECT s.student_number, s.national_id, s.full_name, s.guardian_phone,
            c.name_ar AS class_name, sec.name_ar AS section_name,
            b.total_due, b.total_paid, b.balance, b.total_discount, b.payment_status
     FROM students s
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $1
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     JOIN enrollment_balances b ON b.enrollment_id = e.id
     WHERE ${where.join(' AND ')}
     ORDER BY c.sort_order NULLS LAST, s.full_name`,
    params
  );

  const totals = rows.reduce((t, x) => ({
    due: t.due + Math.round(Number(x.total_due) * 100),
    paid: t.paid + Math.round(Number(x.total_paid) * 100),
    balance: t.balance + Math.round(Number(x.balance) * 100),
    discount: t.discount + Math.round(Number(x.total_discount) * 100)
  }), { due: 0, paid: 0, balance: 0, discount: 0 });

  return {
    title: 'تقرير الطلاب المالي',
    year,
    rows,
    totals: {
      count: rows.length,
      total_due: (totals.due / 100).toFixed(2),
      total_paid: (totals.paid / 100).toFixed(2),
      balance: (totals.balance / 100).toFixed(2),
      total_discount: (totals.discount / 100).toFixed(2)
    },
    columns: [
      ['student_number', 'رقم الطالب'], ['national_id', 'الرقم الوطني'], ['full_name', 'اسم الطالب'],
      ['guardian_phone', 'هاتف ولي الأمر'], ['class_name', 'الصف'], ['section_name', 'الفصل'],
      ['total_due', 'المستحق'], ['total_paid', 'المدفوع'], ['balance', 'المتبقي'],
      ['payment_status_ar', 'الحالة']
    ]
  };
}

/* ================= تحصيلات فترة / اليوم ================= */

async function collectionsReport(q) {
  const from = dateOnly(q.from) || new Date().toISOString().slice(0, 10);
  const to = dateOnly(q.to) || from;
  const params = [from, to];
  const where = [`p.status = 'active'`, `p.paid_at >= $1::date`, `p.paid_at < ($2::date + interval '1 day')`];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (q.method_id) add('p.method_id = ?', v.intId(q.method_id, 'طريقة الدفع'));
  if (q.user_id) add('p.created_by = ?', v.intId(q.user_id, 'الموظف'));
  if (q.class_id) add('e.class_id = ?', v.intId(q.class_id, 'الصف'));
  if (q.year_id) add('e.academic_year_id = ?', v.intId(q.year_id, 'السنة'));

  const base = `FROM payments p
    JOIN students s ON s.id = p.student_id
    JOIN student_enrollments e ON e.id = p.enrollment_id
    JOIN payment_methods m ON m.id = p.method_id
    JOIN users u ON u.id = p.created_by
    WHERE ${where.join(' AND ')}`;

  const [rows, byMethod, summary] = await Promise.all([
    many(
      `SELECT p.paid_at, p.receipt_number, p.amount, s.full_name, s.national_id, s.student_number,
              m.name_ar AS method_name, u.full_name AS cashier
       ${base} ORDER BY p.paid_at`,
      params
    ),
    many(`SELECT m.name_ar AS label, COALESCE(SUM(p.amount),0)::numeric(14,2) AS value, COUNT(*)::int AS count ${base} GROUP BY m.id, m.name_ar ORDER BY m.name_ar`, params),
    one(`SELECT COALESCE(SUM(p.amount),0)::numeric(14,2) AS total, COUNT(*)::int AS count ${base}`, params)
  ]);

  return {
    title: from === to ? `تحصيلات يوم ${from}` : `التحصيلات من ${from} إلى ${to}`,
    from, to, rows, by_method: byMethod, totals: summary,
    columns: [
      ['time', 'الوقت'], ['receipt_number', 'الإيصال'], ['full_name', 'الطالب'],
      ['national_id', 'الرقم الوطني'], ['amount', 'المبلغ'], ['method_name', 'الطريقة'], ['cashier', 'الموظف']
    ]
  };
}

/* ================= تقرير الموظف ================= */

async function staffReport(q) {
  const from = dateOnly(q.from) || new Date().toISOString().slice(0, 10);
  const to = dateOnly(q.to) || from;
  const userId = v.intId(q.user_id, 'الموظف', { required: false });

  const params = [from, to];
  let userFilter = '';
  if (userId) { params.push(userId); userFilter = ` AND p.created_by = $${params.length}`; }

  const rows = await many(
    `SELECT u.id, u.full_name,
            COUNT(*) FILTER (WHERE p.status='active')::int AS payments,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='active'),0)::numeric(14,2) AS total,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='active' AND m.code='cash'),0)::numeric(14,2) AS cash,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='active' AND m.code='card'),0)::numeric(14,2) AS card,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='active' AND m.code='transfer'),0)::numeric(14,2) AS transfer,
            COUNT(*) FILTER (WHERE p.status='void')::int AS voided
     FROM users u
     JOIN payments p ON p.created_by = u.id
       AND p.paid_at >= $1::date AND p.paid_at < ($2::date + interval '1 day')${userFilter}
     JOIN payment_methods m ON m.id = p.method_id
     GROUP BY u.id ORDER BY total DESC`,
    params
  );

  const extra = userId
    ? await one(
      `SELECT
         (SELECT COUNT(*)::int FROM audit_logs a WHERE a.user_id = $1 AND a.action = 'student_create'
            AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')) AS students_added,
         (SELECT COUNT(*)::int FROM audit_logs a WHERE a.user_id = $1 AND a.action IN ('student_update','fee_update')
            AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')) AS edits`,
      [userId, from, to]
    )
    : null;

  return {
    title: 'تقرير الموظفين', from, to, rows, extra,
    columns: [
      ['full_name', 'الموظف'], ['payments', 'عدد الدفعات'], ['total', 'الإجمالي'],
      ['cash', 'نقدًا'], ['card', 'بطاقة'], ['transfer', 'تحويل'], ['voided', 'ملغاة']
    ]
  };
}

/* ================= الخصومات والإيصالات الملغاة ================= */

async function discountsReport(q) {
  const year = await yearOf(v.intId(q.year_id, 'السنة', { required: false }));
  const rows = await many(
    `SELECT s.student_number, s.full_name, s.national_id, t.name_ar AS fee_name,
            f.amount, f.discount, f.discount_reason, u.full_name AS granted_by, f.discount_at
     FROM student_fees f
     JOIN fee_types t ON t.id = f.fee_type_id
     JOIN student_enrollments e ON e.id = f.enrollment_id AND e.academic_year_id = $1
     JOIN students s ON s.id = e.student_id
     LEFT JOIN users u ON u.id = f.discount_by
     WHERE f.discount > 0 ORDER BY f.discount DESC`,
    [year.id]
  );
  const total = rows.reduce((s, x) => s + Math.round(Number(x.discount) * 100), 0);
  return {
    title: 'تقرير الخصومات', year, rows,
    totals: { count: rows.length, total_discount: (total / 100).toFixed(2) },
    columns: [
      ['student_number', 'رقم الطالب'], ['full_name', 'الطالب'], ['fee_name', 'البند'],
      ['amount', 'القيمة الأصلية'], ['discount', 'الخصم'], ['discount_reason', 'السبب'],
      ['granted_by', 'اعتمده'], ['discount_at', 'التاريخ']
    ]
  };
}

async function voidedReport(q) {
  const from = dateOnly(q.from);
  const to = dateOnly(q.to);
  const params = [];
  const where = [`p.status = 'void'`];
  if (from) { params.push(from); where.push(`p.voided_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`p.voided_at < ($${params.length}::date + interval '1 day')`); }
  const rows = await many(
    `SELECT p.receipt_number, p.amount, p.paid_at, p.voided_at, p.void_reason,
            s.full_name, s.national_id, u.full_name AS cashier, vu.full_name AS voided_by
     FROM payments p JOIN students s ON s.id = p.student_id
     JOIN users u ON u.id = p.created_by LEFT JOIN users vu ON vu.id = p.voided_by
     WHERE ${where.join(' AND ')} ORDER BY p.voided_at DESC`,
    params
  );
  const total = rows.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);
  return {
    title: 'الإيصالات الملغاة', rows,
    totals: { count: rows.length, total: (total / 100).toFixed(2) },
    columns: [
      ['receipt_number', 'الإيصال'], ['full_name', 'الطالب'], ['amount', 'المبلغ'],
      ['voided_by', 'ألغاها'], ['void_reason', 'السبب'], ['voided_at', 'وقت الإلغاء']
    ]
  };
}

const REPORTS = {
  students: studentsReport,
  collections: collectionsReport,
  daily: (q) => collectionsReport({ ...q, from: q.date || q.from, to: q.date || q.to }),
  staff: staffReport,
  discounts: discountsReport,
  voided: voidedReport
};

const STATUS_AR = { paid: 'مسدد بالكامل', partial: 'مسدد جزئيًا', unpaid: 'غير مسدد' };

function decorate(report) {
  report.rows = (report.rows || []).map((row) => ({
    ...row,
    payment_status_ar: STATUS_AR[row.payment_status] || row.payment_status,
    time: row.paid_at ? new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(row.paid_at)) : undefined
  }));
  return report;
}

/* ================= المسارات ================= */

r.get('/:type', wrap(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw badRequest('نوع التقرير غير معروف.');
  res.json(decorate(await fn(req.query)));
}));

/** تصدير Excel محترمًا نفس الفلاتر */
r.get('/:type/export.xlsx', requirePermission('reports.export'), wrap(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw badRequest('نوع التقرير غير معروف.');
  const report = decorate(await fn(req.query));
  const settings = await getSettings();

  const wb = new ExcelJS.Workbook();
  wb.creator = settings.school_name || 'المنظومة المالية';
  const ws = wb.addWorksheet('التقرير', { views: [{ rightToLeft: true }] });

  ws.mergeCells(1, 1, 1, report.columns.length);
  ws.getCell(1, 1).value = `${settings.school_name || ''} — ${report.title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };

  ws.addRow(report.columns.map(([, label]) => label));
  const header = ws.getRow(2);
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF5FB' } }; });

  for (const row of report.rows) {
    ws.addRow(report.columns.map(([key]) => {
      const val = row[key];
      if (val === null || val === undefined) return '';
      // الأرقام الوطنية والهواتف نصًا حتى لا تُفقد الأصفار
      if (key === 'national_id' || key.includes('phone') || key === 'student_number' || key === 'receipt_number') return String(val);
      if (/^-?\d+\.\d{2}$/.test(String(val))) return Number(val);
      if (val instanceof Date) return new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'short' }).format(val);
      return val;
    }));
  }

  report.columns.forEach((_, i) => { ws.getColumn(i + 1).width = 18; });
  if (report.totals) {
    ws.addRow([]);
    ws.addRow(['الإجمالي', ...Object.entries(report.totals).map(([, val]) => val)]);
    ws.lastRow.font = { bold: true };
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.type}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

/** نسخة HTML للطباعة، ونفسها مصدر PDF */
function reportHtml(report, settings) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = report.columns.map(([, l]) => `<th>${esc(l)}</th>`).join('');
  const body = report.rows.map((row) => `<tr>${report.columns.map(([k]) => `<td>${esc(row[k] ?? '')}</td>`).join('')}</tr>`).join('');
  const totals = report.totals
    ? `<div class="totals">${Object.entries(report.totals).map(([k, val]) => `<span><b>${esc(val)}</b> ${esc(TOTAL_LABELS[k] || k)}</span>`).join('')}</div>`
    : '';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(report.title)}</title>
<style>
 @page { size: A4 landscape; margin: 10mm; }
 body { font-family: "Cairo","Noto Naskh Arabic","Tahoma",sans-serif; font-size: 12px; color:#10202f; }
 h1 { font-size: 16px; margin: 0 0 2px; } .sub { color:#4a5b6b; font-size: 11px; margin-bottom: 8px; }
 table { width:100%; border-collapse: collapse; }
 th,td { border:1px solid #ccd7e2; padding:4px 6px; text-align:right; }
 th { background:#eef5fb; } tbody tr:nth-child(even){ background:#fafcfe; }
 .totals { margin-top:10px; display:flex; gap:18px; flex-wrap:wrap; font-size:12px; }
 .totals b { font-size: 14px; }
</style></head><body>
<h1>${esc(settings.school_name || '')} — ${esc(report.title)}</h1>
<div class="sub">${esc(new Date().toLocaleString('en-GB', { timeZone: config.timezone }))} · عدد السجلات: ${report.rows.length}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${totals}
</body></html>`;
}

const TOTAL_LABELS = {
  count: 'سجل', total_due: 'إجمالي المستحق', total_paid: 'إجمالي المدفوع',
  balance: 'إجمالي المتبقي', total_discount: 'إجمالي الخصومات', total: 'الإجمالي', total_discount_: 'الخصومات'
};

r.get('/:type/print', wrap(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw badRequest('نوع التقرير غير معروف.');
  const report = decorate(await fn(req.query));
  res.type('html').send(reportHtml(report, await getSettings()));
}));

r.get('/:type/export.pdf', requirePermission('reports.export'), wrap(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw badRequest('نوع التقرير غير معروف.');
  if (!(await pdfAvailable())) {
    throw new AppError(501, 'pdf_unavailable',
      'تنزيل PDF غير متاح على هذا الخادم. استخدم زر الطباعة ثم «حفظ كـ PDF».');
  }
  const report = decorate(await fn(req.query));
  const pdf = await htmlToPdf(reportHtml(report, await getSettings()));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.type}.pdf"`);
  res.send(pdf);
}));

export default r;
