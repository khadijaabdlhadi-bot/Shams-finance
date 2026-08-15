import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { many, one } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePermission, checkPassword } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import v from '../lib/validate.js';
import {
  createBackup, restoreBackup, inspectBackup, verificationCounts, readRestoreLog
} from '../services/backup.js';

const r = Router();
r.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.paths.tmp),
    filename: (_req, file, cb) => cb(null, `restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.zip`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

/* ---------------- القائمة ---------------- */

r.get('/', requirePermission('backup.manage'), wrap(async (_req, res) => {
  const rows = await many(
    `SELECT b.*, u.full_name AS created_by_name FROM backups b
     LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 100`
  );
  res.json({
    backups: rows.map((b) => ({
      ...b,
      exists: fs.existsSync(path.join(config.paths.backups, b.filename))
    })),
    counts: await verificationCounts(),
    directory: config.paths.backups,
    auto: config.backup.auto,
    keep: config.backup.keep,
    restore_log: readRestoreLog()
  });
}));

/* ---------------- إنشاء ---------------- */

r.post('/', requirePermission('backup.manage'), wrap(async (req, res) => {
  const out = await createBackup({ kind: 'manual', user: req.user });
  await audit(null, req, {
    action: ACTIONS.BACKUP_CREATE, entity: 'backup', entityId: out.id,
    description: `إنشاء نسخة احتياطية ${out.filename} (${Math.round(out.size_bytes / 1024)} ك.ب)`,
    newValues: { filename: out.filename, counts: out.counts }
  });
  res.json({ ok: true, message: `تم إنشاء النسخة الاحتياطية: ${out.filename}`, backup: out });
}));

/* ---------------- تنزيل ---------------- */

r.get('/:id/download', requirePermission('backup.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'النسخة');
  const row = await one('SELECT * FROM backups WHERE id = $1', [id]);
  if (!row) throw notFound('النسخة غير موجودة.');
  const file = path.join(config.paths.backups, row.filename);
  if (!fs.existsSync(file)) throw notFound('ملف النسخة غير موجود على القرص.');
  res.download(file, row.filename);
}));

/* ---------------- حذف ---------------- */

r.delete('/:id', requirePermission('backup.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'النسخة');
  const row = await one('SELECT * FROM backups WHERE id = $1', [id]);
  if (!row) throw notFound('النسخة غير موجودة.');
  const file = path.join(config.paths.backups, row.filename);
  try { fs.existsSync(file) && fs.unlinkSync(file); } catch { /* ignore */ }
  await one('DELETE FROM backups WHERE id = $1 RETURNING id', [id]);
  await audit(null, req, {
    action: ACTIONS.BACKUP_DELETE, entity: 'backup', entityId: id, description: `حذف النسخة ${row.filename}`
  });
  res.json({ ok: true });
}));

/* ---------------- فحص نسخة قبل الاسترجاع ---------------- */

r.post('/inspect', requirePermission('backup.restore'), upload.single('file'), wrap(async (req, res) => {
  const file = req.file
    ? req.file.path
    : path.join(config.paths.backups, path.basename(String(req.body?.filename || '')));
  if (!fs.existsSync(file)) throw badRequest('لم يتم تحديد ملف نسخة صالح.');

  const info = await inspectBackup(file);
  res.json({
    ok: true,
    token: req.file ? path.basename(req.file.path) : null,
    filename: req.file ? req.file.originalname : path.basename(file),
    manifest: info.manifest,
    sha256: info.sha256,
    size: info.size,
    current: await verificationCounts(),
    warning: 'الاسترجاع سيستبدل كل البيانات الحالية بمحتوى هذه النسخة. سيأخذ النظام نسخة احتياطية تلقائية للحالة الحالية قبل التنفيذ.'
  });
}));

/* ---------------- الاسترجاع ---------------- */

r.post('/restore', requirePermission('backup.restore'), wrap(async (req, res) => {
  const confirm = String(req.body?.confirm || '').trim();
  if (confirm !== 'استرجاع') {
    throw badRequest('للتأكيد اكتب كلمة «استرجاع» في الحقل المخصص.');
  }

  // إعادة التحقق من كلمة مرور المنفّذ — عملية لا رجعة فيها
  const password = String(req.body?.password || '');
  const me = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!password || !checkPassword(password, me.password_hash)) {
    throw forbidden('كلمة المرور غير صحيحة. الاسترجاع يتطلب تأكيد هوية المنفّذ.');
  }

  const file = req.body?.token
    ? path.join(config.paths.tmp, path.basename(String(req.body.token)))
    : path.join(config.paths.backups, path.basename(String(req.body?.filename || '')));
  if (!fs.existsSync(file)) throw badRequest('ملف النسخة غير موجود. أعد رفعه ثم حاول مجددًا.');

  const result = await restoreBackup(file, { user: req.user, req });

  res.json({
    ok: result.ok,
    message: result.ok
      ? 'تم استرجاع النسخة بنجاح واجتاز الفحص جميع الاختبارات.'
      : 'تم الاسترجاع لكن بعض أعداد التحقق غير مطابقة — راجع التفاصيل.',
    ...result
  });
}));

r.get('/verify', requirePermission('backup.manage'), wrap(async (_req, res) => {
  res.json(await verificationCounts());
}));

export default r;
