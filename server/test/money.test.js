import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, toDecimalString, isValidAmount, formatMoney } from '../src/lib/money.js';
import v from '../src/lib/validate.js';
import { autoAllocate, validateAllocations } from '../src/services/payments.js';

/* ---------------- المال بلا أخطاء عشرية ---------------- */

test('0.1 + 0.2 لا تنتج خطأ عشريًا', () => {
  assert.equal(toDecimalString(toMinor('0.1') + toMinor('0.2')), '0.30');
});

test('المبالغ الكبيرة تبقى دقيقة', () => {
  const sum = toMinor('999999.99') + toMinor('0.01');
  assert.equal(toDecimalString(sum), '1000000.00');
});

test('يقبل الفاصلة العشرية العربية والفواصل الألفية', () => {
  assert.equal(toDecimalString(toMinor('1,500.50')), '1500.50');
  assert.equal(toDecimalString(toMinor('٢٠٠')), '200.00');
});

test('يرفض القيم غير الرقمية', () => {
  assert.throws(() => toMinor('abc'));
  assert.equal(isValidAmount('-5'), false);
  assert.equal(isValidAmount('0', { allowZero: false }), false);
});

test('التنسيق للعرض يفصل الآلاف', () => {
  assert.equal(formatMoney('1500', 'د.ل'), '1,500.00 د.ل');
});

/* ---------------- الرقم الوطني والهواتف ---------------- */

test('الرقم الوطني يحافظ على الأصفار في البداية', () => {
  assert.equal(v.nationalId('0012345678901'), '0012345678901');
  assert.equal(v.nationalId(' 001-234-5678 '), '0012345678');
});

test('الرقم الوطني يقبل الأرقام العربية ويحوّلها', () => {
  assert.equal(v.nationalId('٠٠١٢٣٤'), '001234');
});

test('الرقم الوطني مطلوب ولا يقبل الحروف', () => {
  assert.throws(() => v.nationalId(''), /مطلوب/);
  assert.throws(() => v.nationalId('12A45'), /أرقام فقط/);
});

test('الهاتف يحافظ على الصفر في البداية', () => {
  assert.equal(v.phone('0912345678'), '0912345678');
  assert.equal(v.phone(''), null);
  assert.throws(() => v.phone('12'), /غير صالح/);
});

test('المبالغ السالبة مرفوضة في المدخلات', () => {
  assert.throws(() => v.amount('-100', 'الرسوم'), /سالب|رقمًا/);
  assert.equal(v.amount('2000', 'الرسوم'), '2000.00');
  assert.equal(v.amount('', 'الرسوم'), '0.00');
});

/* ---------------- الحساب المالي ---------------- */

const fees = () => ([
  { id: 1, amount: '2000.00', discount: '100.00', required: true, paid: '0.00', name_ar: 'الرسوم الدراسية', code: 'tuition' },
  { id: 2, amount: '150.00', discount: '0.00', required: true, paid: '0.00', name_ar: 'رسوم التسجيل', code: 'registration' },
  { id: 3, amount: '120.00', discount: '0.00', required: false, paid: '0.00', name_ar: 'الزي', code: 'uniform' }
]);

test('إجمالي المستحق = الرسوم - الخصم، والزي غير المطلوب لا يُحتسب', () => {
  const due = fees().reduce((s, f) => (f.required ? s + toMinor(f.amount) - toMinor(f.discount) : s), 0);
  assert.equal(toDecimalString(due), '2050.00');
});

test('التوزيع التلقائي يملأ البنود بالترتيب', () => {
  const alloc = autoAllocate(fees(), toMinor('2000'));
  assert.equal(alloc.length, 2);
  assert.equal(toDecimalString(alloc[0].minor), '1900.00');   // الرسوم الدراسية بعد الخصم
  assert.equal(toDecimalString(alloc[1].minor), '100.00');    // ما تبقى على التسجيل
});

test('التوزيع التلقائي يتجاهل البنود غير المطلوبة', () => {
  const alloc = autoAllocate(fees(), toMinor('2050'));
  assert.equal(alloc.every((a) => a.student_fee_id !== 3), true);
});

test('التوزيع اليدوي يجب أن يساوي مبلغ الدفعة', () => {
  assert.throws(
    () => validateAllocations([{ student_fee_id: 1, amount: '500' }], fees(), toMinor('700')),
    /لا يساوي قيمة الدفعة/
  );
  const ok = validateAllocations(
    [{ student_fee_id: 1, amount: '600' }, { student_fee_id: 2, amount: '100' }], fees(), toMinor('700')
  );
  assert.equal(ok.length, 2);
});

test('التوزيع اليدوي يرفض تجاوز المتبقي على البند', () => {
  assert.throws(
    () => validateAllocations([{ student_fee_id: 2, amount: '500' }], fees(), toMinor('500')),
    /أكبر من المتبقي/
  );
});

test('حالة الدفع تُحسب من المدفوع والمستحق', () => {
  const status = (due, paid) => (paid >= due && due > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
  assert.equal(status(toMinor('2050'), toMinor('2050')), 'paid');
  assert.equal(status(toMinor('2050'), toMinor('700')), 'partial');
  assert.equal(status(toMinor('2050'), toMinor('0')), 'unpaid');
});
