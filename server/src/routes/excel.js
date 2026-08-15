import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one, many, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import v from '../lib/validate.js';
import { getSettings } from './settings.js';
import { createStudent } from '../services/students.js';
import {
  buildTemplate, readWorkbook, autoMapping, validateRows, TEMPLATE_COLUMNS, STATUS_LABELS
} from '../services/excel.js';
import {
  fetchStudentsForExport, buildStudentsWorkbook, appendInstallmentsSheet
} from '../services/export.js';

const r = Router();
r.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.paths.tmp),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.xlsx`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xlsm)$/i.test(file.originalname);
    cb(ok ? null : badRequest('الملف يجب أن يكون بصيغة .xlsx'), ok);
  }
});

/* ---------------- تحميل النموذج ---------------- */

r.get('/template', requirePermission('excel.import'), wrap(async (_req, res) => {
  const settings = await getSettings();
  const classes = (await many('SELECT name_ar FROM classes WHERE active ORDER BY sort_order')).map((c) => c.name_ar);
  const year = await one('SELECT name FROM academic_years WHERE is_current LIMIT 1');
  const wb = await buildTemplate(settings, { classes, year: year?.name });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="students-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

/* ---------------- تصدير الطلاب الموجودين فعليًا ---------------- */

const STATUS_LABEL = { paid: 'مسدد بالكامل', partial: 'مسدد جزئيًا', unpaid: 'غير مسدد' };

/**
 * تصدير الطلاب من قاعدة البيانات — وليس نموذجًا فارغًا.
 * بلا فلاتر ⇒ كل الطلاب. ومع الفلاتر ⇒ نفس ما يراه المستخدم على الشاشة تمامًا.
 */
r.get('/students/export.xlsx', requirePermission('students.view'), wrap(async (req, res) => {
  const settings = await getSettings();
  const year = req.query.year_id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [v.intId(req.query.year_id, 'السنة')])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!year) throw badRequest('لا توجد سنة دراسية محددة.');

  const classId = v.intId(req.query.class_id, 'الصف', { required: false });
  const sectionId = v.intId(req.query.section_id, 'الفصل', { required: false });
  const paymentStatus = req.query.payment_status || 'all';
  const status = req.query.status || 'active';
  const search = v.optString(req.query.q, { max: 80 });

  const rows = await fetchStudentsForExport({
    yearId: year.id, search, status, paymentStatus, classId, sectionId,
    onlyBalance: req.query.only_balance === '1'
  });

  // وصف الفلاتر يُكتب داخل الملف نفسه حتى يعرف القارئ ما الذي يراه
  const filters = [`السنة ${year.name}`];
  if (paymentStatus !== 'all') filters.push(STATUS_LABEL[paymentStatus] || paymentStatus);
  if (classId) {
    const c = await one('SELECT name_ar FROM classes WHERE id = $1', [classId]);
    if (c) filters.push(`الصف ${c.name_ar}`);
  }
  if (sectionId) {
    const sec = await one('SELECT name_ar FROM sections WHERE id = $1', [sectionId]);
    if (sec) filters.push(`الفصل ${sec.name_ar}`);
  }
  if (status === 'archived') filters.push('المؤرشفون');
  if (search) filters.push(`بحث: ${search}`);
  if (req.query.only_balance === '1') filters.push('عليهم متبقٍ فقط');

  const scoped = filters.length > 1 || search;
  const wb = await buildStudentsWorkbook(rows, {
    settings,
    title: scoped ? 'بيانات الطلاب (نتائج مفلترة)' : 'بيانات جميع الطلاب',
    filters
  });
  await appendInstallmentsSheet(wb, year.id);

  await audit(null, req, {
    action: ACTIONS.EXCEL_EXPORT, entity: 'students',
    description: `تصدير ${rows.length} طالبًا إلى Excel${scoped ? ` (${filters.join('، ')})` : ' (جميع الطلاب)'}`,
    newValues: { count: rows.length, filters }
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="students-${stamp}.xlsx"`);
  res.setHeader('X-Row-Count', String(rows.length));
  await wb.xlsx.write(res);
  res.end();
}));

/** عدد الصفوف التي سيحتويها التصدير — لعرضه على الزر قبل التنزيل */
r.get('/students/export-count', requirePermission('students.view'), wrap(async (req, res) => {
  const year = req.query.year_id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [v.intId(req.query.year_id, 'السنة')])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!year) throw badRequest('لا توجد سنة دراسية محددة.');
  const rows = await fetchStudentsForExport({
    yearId: year.id,
    search: v.optString(req.query.q, { max: 80 }),
    status: req.query.status || 'active',
    paymentStatus: req.query.payment_status || 'all',
    classId: v.intId(req.query.class_id, 'الصف', { required: false }),
    sectionId: v.intId(req.query.section_id, 'الفصل', { required: false }),
    onlyBalance: req.query.only_balance === '1'
  });
  res.json({ count: rows.length, year });
}));

r.get('/columns', requirePermission('excel.import'), wrap(async (_req, res) => {
  res.json(TEMPLATE_COLUMNS.map(({ key, label, required }) => ({ key, label, required: !!required })));
}));

/* ---------------- 1) الرفع ---------------- */

r.post('/upload', requirePermission('excel.import'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw badRequest('لم يتم اختيار ملف.');
  const buffer = fs.readFileSync(req.file.path);
  const { headers, rows } = await readWorkbook(buffer);
  if (!rows.length) {
    fs.unlinkSync(req.file.path);
    throw badRequest('الملف لا يحتوي على أي صف بيانات.');
  }
  res.json({
    upload_id: path.basename(req.file.path),
    filename: req.file.originalname,
    headers,
    total_rows: rows.length,
    mapping: autoMapping(headers),
    sample: rows.slice(0, 5),
    columns: TEMPLATE_COLUMNS.map(({ key, label, required }) => ({ key, label, required: !!required }))
  });
}));

async function loadUpload(uploadId) {
  const safe = path.basename(String(uploadId || ''));
  const file = path.join(config.paths.tmp, safe);
  if (!safe || !fs.existsSync(file)) throw notFound('انتهت صلاحية الملف المرفوع، يرجى رفعه مرة أخرى.');
  return { file, ...(await readWorkbook(fs.readFileSync(file))) };
}

async function lookups() {
  const classes = await many('SELECT id, name_ar FROM classes');
  const sections = await many('SELECT id, class_id, name_ar FROM sections');
  const norm = (s) => String(s || '').replace(/[\s_ـ]/g, '').trim();
  return {
    classesByName: Object.fromEntries(classes.map((c) => [norm(c.name_ar), c.id])),
    sectionsByKey: Object.fromEntries(sections.map((s) => [`${s.class_id}:${norm(s.name_ar)}`, s.id]))
  };
}

/* ---------------- 2) المعاينة والفحص ---------------- */

r.post('/preview', requirePermission('excel.import'), wrap(async (req, res) => {
  const { rows } = await loadUpload(req.body?.upload_id);
  const mapping = req.body?.mapping || {};
  if (!mapping.national_id || !mapping.full_name) {
    throw badRequest('يجب ربط عمودَي «الرقم الوطني» و«اسم الطالب» على الأقل.');
  }

  const ids = rows
    .map((x) => String(x.values[mapping.national_id] ?? '').replace(/[\s\-_.]/g, '').trim())
    .filter(Boolean);
  const existing = new Set(
    (await many('SELECT national_id FROM students WHERE national_id = ANY($1)', [ids])).map((x) => x.national_id)
  );

  const checked = validateRows(rows, mapping, { existingIds: existing, ...(await lookups()) });
  const counts = checked.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    total: checked.length,
    counts,
    status_labels: STATUS_LABELS,
    ready: counts.ready || 0,
    rows: checked
  });
}));

/* ---------------- 3) الاستيراد الفعلي ---------------- */

r.post('/import', requirePermission('excel.import'), wrap(async (req, res) => {
  const uploadId = req.body?.upload_id;
  const { file, rows } = await loadUpload(uploadId);
  const mapping = req.body?.mapping || {};
  const settings = await getSettings();

  const year = req.body?.academic_year_id
    ? await one('SELECT * FROM academic_years WHERE id = $1', [v.intId(req.body.academic_year_id, 'السنة')])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!year) throw badRequest('لا توجد سنة دراسية محددة.');

  const ids = rows
    .map((x) => String(x.values[mapping.national_id] ?? '').replace(/[\s\-_.]/g, '').trim())
    .filter(Boolean);
  const existing = new Set(
    (await many('SELECT national_id FROM students WHERE national_id = ANY($1)', [ids])).map((x) => x.national_id)
  );
  const checked = validateRows(rows, mapping, { existingIds: existing, ...(await lookups()) });

  const feeTypes = Object.fromEntries(
    (await many('SELECT id, code FROM fee_types WHERE active')).map((t) => [t.code, t.id])
  );

  const report = { imported: 0, skipped: 0, duplicates: 0, errors: 0, rows: [] };

  const importId = await tx(async (c) => {
    const { rows: [imp] } = await c.query(
      `INSERT INTO excel_imports (filename, academic_year_id, total_rows, created_by, status)
       VALUES ($1,$2,$3,$4,'running') RETURNING id`,
      [String(req.body?.filename || uploadId), year.id, checked.length, req.user.id]
    );

    for (const row of checked) {
      if (row.status !== 'ready') {
        if (row.status === 'duplicate_in_file' || row.status === 'exists') report.duplicates++;
        else report.errors++;
        report.skipped++;
        await c.query(
          `INSERT INTO excel_import_errors (import_id, row_number, national_id, full_name, reason_code, message, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [imp.id, row.row_number, row.data.national_id, row.data.full_name, row.status,
            row.issues.join(' ') || STATUS_LABELS[row.status], JSON.stringify(row.data)]
        );
        report.rows.push({ row_number: row.row_number, status: row.status, message: row.issues.join(' ') });
        continue;
      }

      const d = row.data;
      const fees = [
        { fee_type_id: feeTypes.tuition, amount: d.tuition_fee, discount: d.discount, required: true },
        { fee_type_id: feeTypes.registration, amount: d.registration_fee, discount: '0.00', required: true },
        { fee_type_id: feeTypes.uniform, amount: d.uniform_fee, discount: '0.00', required: d.uniform_required },
        { fee_type_id: feeTypes.extra, amount: d.extra_fee, discount: '0.00', required: true }
      ].filter((f) => f.fee_type_id);

      try {
        // نقطة حفظ لكل صف: فشل صف واحد لا يُسقط الاستيراد كله
        await c.query('SAVEPOINT row_import');
        const created = await createStudent(c, req, {
          national_id: d.national_id,
          full_name: d.full_name,
          guardian_name: null,
          guardian_phone: d.guardian_phone,
          extra_phone: d.extra_phone,
          notes: d.notes,
          year,
          class_id: d.class_id,
          section_id: d.section_id,
          fees,
          studentPrefix: settings.student_prefix || 'STU'
        });
        await c.query('RELEASE SAVEPOINT row_import');
        report.imported++;
        report.rows.push({ row_number: row.row_number, status: 'imported', student_number: created.student.student_number });
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT row_import');
        const isDup = err.code === '23505';
        if (isDup) report.duplicates++; else report.errors++;
        report.skipped++;
        await c.query(
          `INSERT INTO excel_import_errors (import_id, row_number, national_id, full_name, reason_code, message, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [imp.id, row.row_number, d.national_id, d.full_name, isDup ? 'exists' : 'error',
            isDup ? 'الرقم الوطني مسجل مسبقًا.' : 'تعذّر حفظ هذا الصف.', JSON.stringify(d)]
        );
        report.rows.push({ row_number: row.row_number, status: isDup ? 'exists' : 'error' });
      }
    }

    await c.query(
      `UPDATE excel_imports SET imported=$1, skipped=$2, duplicates=$3, errors=$4, status='completed' WHERE id=$5`,
      [report.imported, report.skipped, report.duplicates, report.errors, imp.id]
    );

    await audit(c, req, {
      action: ACTIONS.EXCEL_IMPORT, entity: 'excel_import', entityId: imp.id,
      description: `استيراد Excel: ${report.imported} مستورد، ${report.duplicates} مكرر، ${report.errors} خطأ من أصل ${checked.length}`,
      newValues: { total: checked.length, ...report, rows: undefined }
    });

    return imp.id;
  });

  try { fs.unlinkSync(file); } catch { /* الملف المؤقت */ }

  res.json({
    ok: true,
    import_id: importId,
    total: checked.length,
    imported: report.imported,
    skipped: report.skipped,
    duplicates: report.duplicates,
    errors: report.errors,
    rows: report.rows,
    message: `تم استيراد ${report.imported} طالبًا من أصل ${checked.length}.`
  });
}));

/* ---------------- سجل عمليات الاستيراد ---------------- */

r.get('/imports', requirePermission('excel.import'), wrap(async (_req, res) => {
  res.json(await many(
    `SELECT i.*, u.full_name AS created_by_name, y.name AS year_name
     FROM excel_imports i JOIN users u ON u.id = i.created_by
     LEFT JOIN academic_years y ON y.id = i.academic_year_id
     ORDER BY i.id DESC LIMIT 50`
  ));
}));

r.get('/imports/:id/errors', requirePermission('excel.import'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'عملية الاستيراد');
  res.json(await many('SELECT * FROM excel_import_errors WHERE import_id = $1 ORDER BY row_number', [id]));
}));

export default r;
