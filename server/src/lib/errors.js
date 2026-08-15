/**
 * أخطاء يفهمها المستخدم. التفاصيل التقنية تذهب لسجل الخادم فقط.
 */
export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new AppError(400, 'bad_request', message, extra);
export const unauthorized = (message = 'يجب تسجيل الدخول أولًا.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'ليست لديك صلاحية تنفيذ هذه العملية.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'العنصر المطلوب غير موجود.') => new AppError(404, 'not_found', message);
export const conflict = (message, extra) => new AppError(409, 'conflict', message, extra);

/** ترجمة أخطاء PostgreSQL إلى رسائل عربية مفهومة. */
export function translateDbError(err) {
  if (!err || !err.code) return null;
  if (err.code === '23505') {                       // unique_violation
    const c = String(err.constraint || '');
    if (c.includes('national_id')) return conflict('هذا الرقم الوطني مسجل مسبقًا لطالب آخر.');
    if (c.includes('receipt_number')) return conflict('تعذر توليد رقم إيصال فريد، يرجى إعادة المحاولة.');
    if (c.includes('student_number')) return conflict('تعذر توليد رقم طالب فريد، يرجى إعادة المحاولة.');
    if (c.includes('users_username')) return conflict('اسم المستخدم مستخدم مسبقًا.');
    if (c.includes('student_enrollments')) return conflict('الطالب مسجل مسبقًا في هذه السنة الدراسية.');
    if (c.includes('academic_years_name')) return conflict('هذه السنة الدراسية موجودة مسبقًا.');
    return conflict('هذه البيانات مسجلة مسبقًا.');
  }
  if (err.code === '23503') return badRequest('لا يمكن إتمام العملية لوجود بيانات مرتبطة.');
  if (err.code === '23514') return badRequest('إحدى القيم غير مقبولة، يرجى مراجعة المبالغ.');
  if (err.code === '22P02') return badRequest('إحدى القيم المدخلة بصيغة غير صحيحة.');
  return null;
}

export default { AppError, badRequest, unauthorized, forbidden, notFound, conflict, translateDbError };
