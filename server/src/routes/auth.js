import { Router } from 'express';
import { one, query } from '../db.js';
import { config } from '../config.js';
import { signToken, checkPassword, hashPassword, requireAuth, loadUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { badRequest, unauthorized, conflict } from '../lib/errors.js';
import { reqString } from '../lib/validate.js';

const r = Router();

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, username: u.username, email: u.email,
  role: u.role_code, role_name: u.role_name, permissions: u.permissions || [],
  must_change_password: !!u.must_change_password, last_login_at: u.last_login_at
});

// الحد لكل (اسم مستخدم + جهاز) حتى لا يمنع خطأُ موظفٍ زميلَه على نفس الجهاز،
// وقفل الحساب بعد 6 محاولات خاطئة يبقى هو خط الدفاع الأول.
r.post('/login', rateLimit({
  windowMs: 60_000, max: 25, key: (req) => `login:${String(req.body?.username || '').toLowerCase()}`
}), wrap(async (req, res) => {
  const username = reqString(req.body?.username, 'اسم المستخدم', { max: 80 });
  const password = String(req.body?.password || '');
  if (!password) throw badRequest('كلمة المرور مطلوبة.');

  const row = await one(
    `SELECT u.*, r.code AS role_code, r.name_ar AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.username_lower = lower($1)`,
    [username]
  );

  const fail = async (message) => {
    await audit(null, { ...req, user: row ? { id: row.id, username: row.username, full_name: row.full_name } : {} }, {
      action: ACTIONS.LOGIN_FAILED, entity: 'user', entityId: row?.id ?? null,
      description: `محاولة دخول فاشلة باسم المستخدم: ${username}`
    });
    throw unauthorized(message);
  };

  if (!row) await fail('اسم المستخدم أو كلمة المرور غير صحيحة.');
  if (!row.active) await fail('هذا الحساب معطّل. راجع مدير النظام.');

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until) - Date.now()) / 60000);
    await fail(`الحساب مقفل مؤقتًا بسبب محاولات خاطئة. حاول بعد ${mins} دقيقة.`);
  }

  if (!checkPassword(password, row.password_hash)) {
    const attempts = (row.failed_attempts || 0) + 1;
    const lock = attempts >= config.login.maxAttempts;
    await query(
      `UPDATE users SET failed_attempts = $1,
              locked_until = CASE WHEN $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
       WHERE id = $4`,
      [lock ? 0 : attempts, lock, String(config.login.lockMinutes), row.id]
    );
    await fail(lock
      ? `تم قفل الحساب ${config.login.lockMinutes} دقيقة بسبب تكرار المحاولات الخاطئة.`
      : 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  await query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [row.id]);
  const user = await loadUser(row.id);
  req.user = user;
  await audit(null, req, { action: ACTIONS.LOGIN, entity: 'user', entityId: user.id, description: 'تسجيل دخول' });

  res.json({ token: signToken({ id: user.id, role_code: user.role_code }), user: publicUser(user) });
}));

r.get('/me', requireAuth, wrap(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

r.post('/logout', requireAuth, wrap(async (req, res) => {
  await audit(null, req, { action: ACTIONS.LOGOUT, entity: 'user', entityId: req.user.id, description: 'تسجيل خروج' });
  res.json({ ok: true });
}));

r.post('/change-password', requireAuth, wrap(async (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (next.length < 8) throw badRequest('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');

  const row = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!checkPassword(current, row.password_hash)) throw badRequest('كلمة المرور الحالية غير صحيحة.');
  if (checkPassword(next, row.password_hash)) {
    throw badRequest('كلمة المرور الجديدة يجب أن تختلف عن الحالية.');
  }

  await query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = now(), updated_by = $2 WHERE id = $3',
    [hashPassword(next), req.user.id, req.user.id]
  );
  await audit(null, req, {
    action: ACTIONS.USER_UPDATE, entity: 'user', entityId: req.user.id, description: 'تغيير كلمة المرور الشخصية'
  });

  // توكن جديد حتى تستمر الجلسة الحالية بلا انقطاع بعد التغيير
  const user = await loadUser(req.user.id);
  res.json({
    ok: true,
    message: 'تم تغيير كلمة المرور. استخدمها في الدخول القادم.',
    token: signToken({ id: user.id, role_code: user.role_code }),
    user: publicUser(user)
  });
}));

/**
 * تغيير اسم المستخدم الشخصي — يتطلب كلمة المرور الحالية.
 * (الاسم القديم يبقى مسجّلًا في سجل العمليات، فلا يضيع أثر من فعل ماذا.)
 */
r.post('/change-username', requireAuth, rateLimit({ windowMs: 60_000, max: 10, key: 'change-username' }), wrap(async (req, res) => {
  const next = reqString(req.body?.new_username, 'اسم المستخدم الجديد', { max: 60 }).replace(/\s+/g, '');
  const password = String(req.body?.password || '');

  if (next.length < 3) throw badRequest('اسم المستخدم يجب ألا يقل عن 3 أحرف.');
  if (!/^[A-Za-z0-9._@-]+$/.test(next)) {
    throw badRequest('اسم المستخدم يقبل الحروف الإنجليزية والأرقام والنقطة والشرطة فقط.');
  }

  const row = await one('SELECT username, password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!password || !checkPassword(password, row.password_hash)) {
    throw badRequest('كلمة المرور الحالية غير صحيحة.');
  }
  if (next.toLowerCase() === String(row.username).toLowerCase()) {
    throw badRequest('اسم المستخدم الجديد مطابق للحالي.');
  }

  const clash = await one('SELECT 1 FROM users WHERE username_lower = lower($1) AND id <> $2', [next, req.user.id]);
  if (clash) throw conflict('اسم المستخدم مستخدم مسبقًا، اختر اسمًا آخر.');

  await query('UPDATE users SET username = $1, updated_at = now(), updated_by = $2 WHERE id = $3',
    [next, req.user.id, req.user.id]);

  await audit(null, req, {
    action: ACTIONS.USER_UPDATE, entity: 'user', entityId: req.user.id,
    description: `تغيير اسم المستخدم من ${row.username} إلى ${next}`,
    oldValues: { username: row.username }, newValues: { username: next }
  });

  const user = await loadUser(req.user.id);
  res.json({
    ok: true,
    message: `تم تغيير اسم المستخدم إلى «${next}». استخدمه في الدخول القادم.`,
    token: signToken({ id: user.id, role_code: user.role_code }),
    user: publicUser(user)
  });
}));

/** تحديث الاسم الكامل والبريد الشخصي (بلا صلاحيات إدارية) */
r.patch('/profile', requireAuth, wrap(async (req, res) => {
  const fullName = reqString(req.body?.full_name, 'الاسم الكامل', { max: 120 });
  const email = req.body?.email ? String(req.body.email).trim().slice(0, 120) : null;
  const before = await one('SELECT full_name, email FROM users WHERE id = $1', [req.user.id]);

  await query('UPDATE users SET full_name = $1, email = $2, updated_at = now(), updated_by = $3 WHERE id = $4',
    [fullName, email, req.user.id, req.user.id]);

  await audit(null, req, {
    action: ACTIONS.USER_UPDATE, entity: 'user', entityId: req.user.id,
    description: 'تعديل البيانات الشخصية',
    oldValues: before, newValues: { full_name: fullName, email }
  });
  res.json({ ok: true, message: 'تم حفظ بياناتك.', user: publicUser(await loadUser(req.user.id)) });
}));

export default r;
