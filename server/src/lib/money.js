/**
 * التعامل مع المال بوحدات صغرى صحيحة (Integer minor units).
 * ممنوع منعًا باتًا استخدام Float في أي حساب مالي:
 *   0.1 + 0.2 = 0.30000000000000004  ← هذا ما نتفاداه.
 *
 * القاعدة: تُخزَّن كـ NUMERIC(14,2) وتُقرأ كنص، ثم تُحوَّل هنا إلى عدد صحيح من الوحدات الصغرى.
 */

const SCALE = 100; // منزلتان عشريتان

/** نص/رقم → عدد صحيح من الوحدات الصغرى. يرمي خطأ إذا لم تكن القيمة صالحة. */
export function toMinor(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('قيمة مالية غير صالحة');
    return Math.round(value * SCALE);
  }
  // تحويل الأرقام العربية/الفارسية أولًا، ثم إزالة فواصل الآلاف
  const s = String(value).trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TypeError('قيمة مالية غير صالحة');
  const neg = s.startsWith('-');
  const [intPart, fracRaw = ''] = s.replace('-', '').split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const minor = BigInt(intPart) * BigInt(SCALE) + BigInt(frac);
  const n = Number(minor);
  if (!Number.isSafeInteger(n)) throw new TypeError('قيمة مالية كبيرة جدًا');
  return neg ? -n : n;
}

/** عدد صحيح من الوحدات الصغرى → نص بمنزلتين، جاهز للحفظ في NUMERIC. */
export function toDecimalString(minor) {
  const n = Math.trunc(Number(minor) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / SCALE)}.${String(abs % SCALE).padStart(2, '0')}`;
}

/** هل القيمة مبلغ صالح (رقم موجب أو صفر، بمنزلتين على الأكثر)؟ */
export function isValidAmount(value, { allowZero = true } = {}) {
  try {
    const m = toMinor(value);
    if (m < 0) return false;
    if (!allowZero && m === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export const add = (...vals) => vals.reduce((s, v) => s + toMinor(v), 0);
export const sub = (a, b) => toMinor(a) - toMinor(b);

/** تنسيق للعرض: 1,500.00 د.ل */
export function formatMoney(value, currency = 'د.ل') {
  const minor = typeof value === 'number' && Number.isInteger(value) && Math.abs(value) > 1e6
    ? value
    : toMinor(value);
  const s = toDecimalString(minor);
  const [i, f] = s.replace('-', '').split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${grouped}.${f}${currency ? ' ' + currency : ''}`;
}

export default { toMinor, toDecimalString, isValidAmount, add, sub, formatMoney };
