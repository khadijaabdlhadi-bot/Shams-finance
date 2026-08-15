import { badRequest } from './errors.js';
import { isValidAmount, toMinor } from './money.js';

/** نص مطلوب */
export function reqString(value, label, { max = 200, min = 1 } = {}) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s.length < min) throw badRequest(`${label} مطلوب.`);
  if (s.length > max) throw badRequest(`${label} أطول من المسموح (${max} حرفًا).`);
  return s;
}

export function optString(value, { max = 500 } = {}) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * الرقم الوطني: نص دائمًا، تُحفظ الأصفار في البداية.
 * نسمح بالأرقام العربية والإنجليزية ونحوّلها، ونزيل المسافات والشرطات فقط.
 */
export function nationalId(value, { required = true } = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const s = normalizeDigits(raw).replace(/[\s\-_.]/g, '').trim();
  if (!s) {
    if (required) throw badRequest('الرقم الوطني مطلوب.');
    return null;
  }
  if (!/^\d{4,32}$/.test(s)) throw badRequest('الرقم الوطني يجب أن يتكون من أرقام فقط (4 خانات على الأقل).');
  return s;                     // ← 0012345 تبقى 0012345
}

/** الهاتف: نص أيضًا حتى لا تُفقد الأصفار في البداية */
export function phone(value, { required = false, label = 'رقم الهاتف' } = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const s = normalizeDigits(raw).replace(/[\s\-().]/g, '').trim();
  if (!s) {
    if (required) throw badRequest(`${label} مطلوب.`);
    return null;
  }
  if (!/^\+?\d{5,20}$/.test(s)) throw badRequest(`${label} غير صالح.`);
  return s;
}

/** تحويل الأرقام العربية/الفارسية إلى إنجليزية */
export function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** مبلغ مالي — يُعاد كنص عشري جاهز للقاعدة */
export function amount(value, label = 'المبلغ', { allowZero = true, required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required && !allowZero) throw badRequest(`${label} مطلوب.`);
    return '0.00';
  }
  const normalized = normalizeDigits(String(value));
  if (!isValidAmount(normalized, { allowZero })) {
    throw badRequest(`${label} يجب أن يكون رقمًا${allowZero ? ' غير سالب' : ' أكبر من صفر'}.`);
  }
  const minor = toMinor(normalized);
  if (minor < 0) throw badRequest(`${label} لا يمكن أن يكون سالبًا.`);
  if (!allowZero && minor === 0) throw badRequest(`${label} يجب أن يكون أكبر من صفر.`);
  return (minor / 100).toFixed(2);
}

export function intId(value, label = 'المعرّف', { required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw badRequest(`${label} مطلوب.`);
    return null;
  }
  const n = Number(normalizeDigits(String(value)));
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label} غير صالح.`);
  return n;
}

export function bool(value, dflt = false) {
  if (value === undefined || value === null || value === '') return dflt;
  return ['1', 'true', 'yes', 'on', 'نعم', 'صح'].includes(String(value).trim().toLowerCase());
}

export function pagination(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(200, Math.max(1, Number(q.size) || 25));
  return { page, size, offset: (page - 1) * size };
}

export default { reqString, optString, nationalId, phone, amount, intId, bool, pagination, normalizeDigits };
