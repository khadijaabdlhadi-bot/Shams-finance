import { pool } from '../db.js';

/**
 * سجل العمليات.
 *
 * - اسم المنفّذ يأتي من الجلسة فقط (req.user) — لا يمكن إرساله من العميل.
 * - الوقت وقت الخادم (now()) — لا نثق بساعة جهاز الموظف.
 * - يُكتب داخل نفس معاملة العملية عند تمرير client ⇒ لا عملية بلا سجل، ولا سجل بلا عملية.
 */
export async function audit(client, req, entry) {
  const runner = client || pool;
  const u = req?.user || {};
  const {
    action, entity = null, entityId = null, studentId = null,
    description = null, oldValues = null, newValues = null
  } = entry;

  await runner.query(
    `INSERT INTO audit_logs
       (user_id, username, full_name, action, entity, entity_id, student_id,
        description, old_values, new_values, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      u.id || null,
      u.username || null,
      u.full_name || null,
      action,
      entity,
      entityId === null ? null : String(entityId),
      studentId,
      description,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      clientIp(req),
      (req?.headers?.['user-agent'] || '').slice(0, 400) || null
    ]
  );
}

export function clientIp(req) {
  if (!req) return null;
  const fwd = req.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '') || null;
}

/** الفروق بين نسختين من سجل — لتخزين القيم القديمة والجديدة فقط. */
export function diff(before = {}, after = {}, fields = null) {
  const keys = fields || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const oldV = {}; const newV = {};
  for (const k of keys) {
    const a = before?.[k]; const b = after?.[k];
    if (String(a ?? '') !== String(b ?? '')) { oldV[k] = a ?? null; newV[k] = b ?? null; }
  }
  return Object.keys(newV).length ? { oldValues: oldV, newValues: newV } : null;
}

export const ACTIONS = {
  LOGIN: 'login', LOGIN_FAILED: 'login_failed', LOGOUT: 'logout',
  STUDENT_CREATE: 'student_create', STUDENT_UPDATE: 'student_update',
  STUDENT_NATIONAL_ID_CHANGE: 'student_national_id_change', STUDENT_ARCHIVE: 'student_archive',
  STUDENT_RESTORE: 'student_restore',
  ENROLLMENT_CREATE: 'enrollment_create', ENROLLMENT_UPDATE: 'enrollment_update',
  FEE_UPDATE: 'fee_update', DISCOUNT_GRANT: 'discount_grant',
  INSTALLMENT_CREATE: 'installment_create', INSTALLMENT_UPDATE: 'installment_update',
  INSTALLMENT_DELETE: 'installment_delete',
  PAYMENT_CREATE: 'payment_create', PAYMENT_VOID: 'payment_void',
  RECEIPT_ISSUE: 'receipt_issue', RECEIPT_REPRINT: 'receipt_reprint',
  EXCEL_IMPORT: 'excel_import', EXCEL_EXPORT: 'excel_export',
  USER_CREATE: 'user_create', USER_UPDATE: 'user_update', USER_DISABLE: 'user_disable',
  ROLE_UPDATE: 'role_update', PERMISSION_UPDATE: 'permission_update',
  BACKUP_CREATE: 'backup_create', BACKUP_DELETE: 'backup_delete', RESTORE: 'restore',
  SETTINGS_UPDATE: 'settings_update'
};

export const ACTION_LABELS = {
  login: 'تسجيل دخول', login_failed: 'محاولة دخول فاشلة', logout: 'تسجيل خروج',
  student_create: 'إضافة طالب', student_update: 'تعديل طالب',
  student_national_id_change: 'تغيير الرقم الوطني', student_archive: 'أرشفة طالب',
  student_restore: 'إلغاء أرشفة طالب',
  enrollment_create: 'تسجيل في سنة دراسية', enrollment_update: 'تعديل التسجيل',
  fee_update: 'تعديل رسوم', discount_grant: 'منح خصم',
  installment_create: 'إضافة قسط', installment_update: 'تعديل قسط', installment_delete: 'حذف قسط',
  payment_create: 'تسجيل دفعة', payment_void: 'إلغاء دفعة',
  receipt_issue: 'إصدار إيصال', receipt_reprint: 'إعادة طباعة إيصال',
  excel_import: 'استيراد Excel', excel_export: 'تصدير Excel',
  user_create: 'إنشاء مستخدم', user_update: 'تعديل مستخدم', user_disable: 'تعطيل مستخدم',
  role_update: 'تعديل دور', permission_update: 'تعديل صلاحيات',
  backup_create: 'نسخة احتياطية', backup_delete: 'حذف نسخة احتياطية', restore: 'استرجاع نسخة',
  settings_update: 'تعديل الإعدادات'
};

export default { audit, diff, clientIp, ACTIONS, ACTION_LABELS };
