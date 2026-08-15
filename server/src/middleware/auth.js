import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { one } from '../db.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export const hashPassword = (plain) => bcrypt.hashSync(String(plain), config.bcryptRounds);
export const checkPassword = (plain, hash) => bcrypt.compareSync(String(plain), String(hash || ''));

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role_code }, config.jwtSecret, {
    expiresIn: `${config.tokenHours}h`
  });
}

const USER_SQL = `
  SELECT u.id, u.full_name, u.username, u.email, u.active, u.role_id, u.last_login_at,
         u.must_change_password,
         r.code AS role_code, r.name_ar AS role_name,
         COALESCE(
           (SELECT array_agg(p.code) FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = u.role_id), '{}'
         ) AS permissions
  FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.id = $1`;

export async function loadUser(id) {
  return one(USER_SQL, [id]);
}

/** يتطلب تسجيل دخول صالح. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.');
    }
    const user = await loadUser(payload.id);
    if (!user || !user.active) throw unauthorized('الحساب غير مفعّل.');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** يتطلب صلاحية بعينها — التحقق في الخادم، لا في الواجهة. */
export function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const owned = new Set(req.user.permissions || []);
    const ok = codes.some((c) => owned.has(c));
    if (!ok) return next(forbidden('ليست لديك صلاحية تنفيذ هذه العملية.'));
    next();
  };
}

export const can = (user, code) => new Set(user?.permissions || []).has(code);

export default { requireAuth, requirePermission, signToken, hashPassword, checkPassword, loadUser, can };
