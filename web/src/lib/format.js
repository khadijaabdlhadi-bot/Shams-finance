/** تنسيق العرض فقط — كل الحسابات تتم في الخادم. */

let CURRENCY = 'د.ل';
export const setCurrency = (c) => { CURRENCY = c || 'د.ل'; };
export const currency = () => CURRENCY;

export function money(value, withCurrency = true) {
  if (value === null || value === undefined || value === '') return withCurrency ? `0.00 ${CURRENCY}` : '0.00';
  const n = String(value);
  const neg = n.startsWith('-');
  const [i, f = '00'] = n.replace('-', '').split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = `${neg ? '-' : ''}${grouped}.${(f + '00').slice(0, 2)}`;
  return withCurrency ? `${out} ${CURRENCY}` : out;
}

export const num = (v) => new Intl.NumberFormat('en-US').format(Number(v) || 0);

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  return `${date} – ${time}`;
}

export function dateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

export const timeOnly = (value) => (value
  ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  : '—');

export const today = () => new Date().toISOString().slice(0, 10);

export const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export default { money, num, dateTime, dateOnly, timeOnly, today, monthStart, setCurrency, currency };
