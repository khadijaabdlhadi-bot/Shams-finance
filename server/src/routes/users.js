import { Router } from 'express';
import { one, many, query, tx } from '../db.js';
import { requireAuth, requirePermission, hashPassword } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, diff, ACTIONS } from '../lib/audit.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import v from '../lib/validate.js';

const r = Router();
r.use(requireAuth);

const SAFE = `u.id, u.full_name, u.username, u.email, u.active, u.role_id, u.last_login_at,
              u.created_at, u.must_change_password, r.code AS role_code, r.name_ar AS role_name`;

r.get('/', requirePermission('users.manage'), wrap(async (_req, res) => {
  res.json(await many(`SELECT ${SAFE} FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`));
}));

r.get('/roles', requireAuth, wrap(async (_req, res) => {
  const roles = await many('SELECT * FROM roles ORDER BY id');
  const perms = await many(
    `SELECT rp.role_id, p.code, p.name_ar, p.group_ar
     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
  );
  const all = await many('SELECT code, name_ar, group_ar FROM permissions ORDER BY id');
  res.json({
    roles: roles.map((role) => ({ ...role, permissions: perms.filter((p) => p.role_id === role.id).map((p) => p.code) })),
    permissions: all
  });
}));

r.post('/', requirePermission('users.manage'), wrap(async (req, res) => {
  const b = req.body || {};
  const full_name = v.reqString(b.full_name, 'الاسم الكامل', { max: 120 });
  const username = v.reqString(b.username, 'اسم المستخدم', { max: 60 }).replace(/\s+/g, '');
  const password = String(b.password || '');
  if (password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف.');
  const roleId = v.intId(b.role_id, 'الدور');

  const role = await one('SELECT * FROM roles WHERE id = $1', [roleId]);
  if (!role) throw badRequest('الدور غير موجود.');
  const clash = await one('SELECT 1 FROM users WHERE username_lower = lower($1)', [username]);
  if (clash) throw conflict('اسم المستخدم مستخدم مسبقًا.');

  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (full_name, username, email, password_hash, role_id, created_by, updated_by, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$6,TRUE) RETURNING id`,
      [full_name, username, v.optString(b.email, { max: 120 }), hashPassword(password), roleId, req.user.id]
    );
    await audit(c, req, {
      action: ACTIONS.USER_CREATE, entity: 'user', entityId: rows[0].id,
      description: `إنشاء المستخدم ${full_name} (${username}) بدور ${role.name_ar}`,
      newValues: { full_name, username, role: role.code }
    });
    return rows[0];
  });

  res.status(201).json(await one(`SELECT ${SAFE} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [user.id]));
}));

r.patch('/:id', requirePermission('users.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'المستخدم');
  const before = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!before) throw notFound('المستخدم غير موجود.');
  const b = req.body || {};

  const patch = {};
  if (b.full_name !== undefined) patch.full_name = v.reqString(b.full_name, 'الاسم الكامل', { max: 120 });

  // تغيير اسم المستخدم: المدير يستطيع تغييره لأي حساب (مثلًا عند خطأ إملائي)
  if (b.username !== undefined) {
    const next = v.reqString(b.username, 'اسم المستخدم', { max: 60 }).replace(/\s+/g, '');
    if (next.toLowerCase() !== String(before.username).toLowerCase()) {
      if (next.length < 3) throw badRequest('اسم المستخدم يجب ألا يقل عن 3 أحرف.');
      if (!/^[A-Za-z0-9._@-]+$/.test(next)) {
        throw badRequest('اسم المستخدم يقبل الحروف الإنجليزية والأرقام والنقطة والشرطة فقط.');
      }
      const taken = await one('SELECT 1 FROM users WHERE username_lower = lower($1) AND id <> $2', [next, id]);
      if (taken) throw conflict('اسم المستخدم مستخدم مسبقًا.');
      patch.username = next;
    }
  }
  if (b.email !== undefined) patch.email = v.optString(b.email, { max: 120 });
  if (b.role_id !== undefined) patch.role_id = v.intId(b.role_id, 'الدور');
  if (b.active !== undefined) {
    patch.active = v.bool(b.active);
    if (!patch.active && id === req.user.id) throw badRequest('لا يمكنك تعطيل حسابك الشخصي.');
    if (!patch.active) {
      const admins = await one(
        `SELECT COUNT(*)::int AS c FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'admin' AND u.active AND u.id <> $1`, [id]
      );
      if (before.role_id && admins.c === 0) {
        const isAdmin = await one(`SELECT 1 FROM roles WHERE id = $1 AND code = 'admin'`, [before.role_id]);
        if (isAdmin) throw badRequest('لا يمكن تعطيل آخر حساب مدير في النظام.');
      }
    }
  }

  let passwordChanged = false;
  if (b.password) {
    if (String(b.password).length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    patch.password_hash = hashPassword(String(b.password));
    patch.must_change_password = true;
    passwordChanged = true;
  }

  if (!Object.keys(patch).length) throw badRequest('لا توجد تغييرات.');

  await tx(async (c) => {
    const keys = Object.keys(patch);
    const values = Object.values(patch);
    values.push(req.user.id, id);
    await c.query(
      `UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')},
              updated_by = $${values.length - 1}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    const shown = { ...patch };
    delete shown.password_hash;
    const d = diff(before, { ...before, ...shown }, Object.keys(shown));
    await audit(c, req, {
      action: patch.active === false ? ACTIONS.USER_DISABLE : ACTIONS.USER_UPDATE,
      entity: 'user', entityId: id,
      description: `تعديل المستخدم ${before.full_name}${passwordChanged ? ' (تغيير كلمة المرور)' : ''}`,
      ...(d || {})
    });
  });

  res.json(await one(`SELECT ${SAFE} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [id]));
}));

/** تعديل صلاحيات دور */
r.put('/roles/:id/permissions', requirePermission('users.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الدور');
  const role = await one('SELECT * FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound('الدور غير موجود.');
  if (role.code === 'admin') throw badRequest('لا يمكن تعديل صلاحيات مدير النظام.');
  const codes = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [];

  const before = (await many(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [id]
  )).map((x) => x.code);

  await tx(async (c) => {
    await c.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    if (codes.length) {
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2)`,
        [id, codes]
      );
    }
    await audit(c, req, {
      action: ACTIONS.PERMISSION_UPDATE, entity: 'role', entityId: id,
      description: `تعديل صلاحيات الدور ${role.name_ar}`,
      oldValues: { permissions: before }, newValues: { permissions: codes }
    });
  });
  res.json({ ok: true });
}));

export default r;
