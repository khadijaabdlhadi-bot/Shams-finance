import { Router } from 'express';
import { many, query, one } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { reqString, intId, bool } from '../lib/validate.js';

const r = Router();

export async function getSettings() {
  const rows = await many('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((x) => [x.key, x.value]));
}

/* ---------------- الإعدادات العامة ---------------- */

// إعدادات عامة يحتاجها كل مستخدم (اسم المدرسة، العملة…) — بلا أسرار
r.get('/public', wrap(async (_req, res) => {
  const s = await getSettings();
  res.json({
    school_name: s.school_name, school_name_en: s.school_name_en, school_short: s.school_short,
    currency: s.currency, logo_path: s.logo_path, date_format: s.date_format
  });
}));

r.get('/', requireAuth, wrap(async (_req, res) => res.json(await getSettings())));

r.put('/', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const before = await getSettings();
  const body = req.body || {};
  const allowed = new Set(Object.keys(before));
  const changed = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) continue;
    const val = v === null ? '' : String(v);
    if (val !== (before[k] ?? '')) changed[k] = val;
  }
  if (!Object.keys(changed).length) return res.json({ ok: true, settings: before });

  for (const [k, v] of Object.entries(changed)) {
    await query('UPDATE settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3',
      [v, req.user.id, k]);
  }
  await audit(null, req, {
    action: ACTIONS.SETTINGS_UPDATE, entity: 'settings',
    description: `تعديل الإعدادات: ${Object.keys(changed).join('، ')}`,
    oldValues: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]])),
    newValues: changed
  });
  res.json({ ok: true, settings: await getSettings() });
}));

/* ---------------- السنوات الدراسية ---------------- */

r.get('/academic-years', requireAuth, wrap(async (_req, res) => {
  res.json(await many('SELECT * FROM academic_years ORDER BY name DESC'));
}));

r.post('/academic-years', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const name = reqString(req.body?.name, 'اسم السنة الدراسية', { max: 20 });
  if (!/^\d{4}\/\d{4}$/.test(name)) throw badRequest('صيغة السنة الدراسية يجب أن تكون مثل 2026/2027.');
  const row = await one('INSERT INTO academic_years (name) VALUES ($1) RETURNING *', [name]);
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'academic_year', entityId: row.id, description: `إضافة سنة دراسية ${name}` });
  res.json(row);
}));

r.post('/academic-years/:id/set-current', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const id = intId(req.params.id, 'السنة الدراسية');
  const year = await one('SELECT * FROM academic_years WHERE id = $1', [id]);
  if (!year) throw notFound('السنة الدراسية غير موجودة.');
  await query('UPDATE academic_years SET is_current = FALSE WHERE is_current');
  await query('UPDATE academic_years SET is_current = TRUE WHERE id = $1', [id]);
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'academic_year', entityId: id, description: `تعيين السنة الحالية: ${year.name}` });
  res.json({ ok: true });
}));

/* ---------------- الصفوف والفصول ---------------- */

r.get('/classes', requireAuth, wrap(async (_req, res) => {
  const classes = await many('SELECT * FROM classes ORDER BY sort_order, id');
  const sections = await many('SELECT * FROM sections ORDER BY name_ar');
  res.json(classes.map((c) => ({ ...c, sections: sections.filter((s) => s.class_id === c.id) })));
}));

r.post('/classes', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const name = reqString(req.body?.name_ar, 'اسم الصف', { max: 60 });
  const row = await one('INSERT INTO classes (name_ar, sort_order) VALUES ($1, COALESCE((SELECT MAX(sort_order)+1 FROM classes),1)) RETURNING *', [name]);
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'class', entityId: row.id, description: `إضافة صف: ${name}` });
  res.json(row);
}));

r.post('/classes/:id/sections', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const classId = intId(req.params.id, 'الصف');
  const name = reqString(req.body?.name_ar, 'اسم الفصل', { max: 40 });
  const row = await one('INSERT INTO sections (class_id, name_ar) VALUES ($1,$2) RETURNING *', [classId, name]);
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'section', entityId: row.id, description: `إضافة فصل: ${name}` });
  res.json(row);
}));

/* ---------------- أنواع الرسوم وطرق الدفع ---------------- */

r.get('/fee-types', requireAuth, wrap(async (_req, res) => {
  res.json(await many('SELECT * FROM fee_types WHERE active ORDER BY sort_order, id'));
}));

r.post('/fee-types', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const code = reqString(req.body?.code, 'رمز الرسم', { max: 40 }).toLowerCase().replace(/\s+/g, '_');
  const name = reqString(req.body?.name_ar, 'اسم الرسم', { max: 80 });
  const optional = bool(req.body?.optional, true);
  const row = await one(
    `INSERT INTO fee_types (code, name_ar, optional, sort_order)
     VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order)+1 FROM fee_types),1)) RETURNING *`,
    [code, name, optional]
  );
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'fee_type', entityId: row.id, description: `إضافة نوع رسوم: ${name}` });
  res.json(row);
}));

r.get('/payment-methods', requireAuth, wrap(async (_req, res) => {
  res.json(await many('SELECT * FROM payment_methods WHERE active ORDER BY sort_order, id'));
}));

r.post('/payment-methods', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const code = reqString(req.body?.code, 'رمز طريقة الدفع', { max: 40 }).toLowerCase().replace(/\s+/g, '_');
  const name = reqString(req.body?.name_ar, 'اسم طريقة الدفع', { max: 60 });
  const row = await one(
    `INSERT INTO payment_methods (code, name_ar, sort_order)
     VALUES ($1,$2, COALESCE((SELECT MAX(sort_order)+1 FROM payment_methods),1)) RETURNING *`,
    [code, name]
  );
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'payment_method', entityId: row.id, description: `إضافة طريقة دفع: ${name}` });
  res.json(row);
}));

r.patch('/payment-methods/:id', requireAuth, requirePermission('settings.manage'), wrap(async (req, res) => {
  const id = intId(req.params.id, 'طريقة الدفع');
  await query('UPDATE payment_methods SET active = COALESCE($1, active), name_ar = COALESCE($2, name_ar) WHERE id = $3',
    [req.body?.active === undefined ? null : bool(req.body.active), req.body?.name_ar || null, id]);
  await audit(null, req, { action: ACTIONS.SETTINGS_UPDATE, entity: 'payment_method', entityId: id, description: 'تعديل طريقة دفع' });
  res.json({ ok: true });
}));

export default r;
