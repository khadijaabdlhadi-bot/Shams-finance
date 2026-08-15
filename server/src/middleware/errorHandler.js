import { AppError, translateDbError } from '../lib/errors.js';

/** 404 لمسارات API غير الموجودة */
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'not_found', message: 'المسار المطلوب غير موجود.' });
  }
  next();
}

/**
 * المستخدم يرى رسالة عربية واضحة فقط.
 * التفاصيل التقنية تُسجَّل في سجل الخادم ولا تُرسل أبدًا.
 */
export function errorHandler(err, req, res, _next) {
  const translated = err instanceof AppError ? err : (translateDbError(err) || null);

  if (translated) {
    return res.status(translated.status).json({
      error: translated.code,
      message: translated.message,
      ...translated.extra
    });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({
    error: 'server_error',
    message: 'تعذّر إتمام العملية ولم يتم حفظ أي تغيير. يرجى المحاولة مرة أخرى.'
  });
}

/** يغلّف معالج async حتى تصل الأخطاء إلى errorHandler */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default { errorHandler, notFoundHandler, wrap };
