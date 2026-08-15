import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRows, autoMapping, TEMPLATE_COLUMNS } from '../src/services/excel.js';

const headers = TEMPLATE_COLUMNS.map((c) => c.label);
const mapping = autoMapping(headers);

const row = (n, over = {}) => ({
  row_number: n,
  values: {
    'الرقم الوطني': '0012345678901',
    'اسم الطالب': 'طالب تجريبي',
    'هاتف ولي الأمر': '0912345678',
    'هاتف إضافي': '',
    الصف: 'الأول',
    الفصل: 'أ',
    'السنة الدراسية': '2026/2027',
    'الرسوم الدراسية': '2000',
    'رسوم التسجيل': '150',
    'سعر الزي': '120',
    'هل الزي مطلوب؟': 'نعم',
    'رسوم إضافية': '0',
    الخصم: '0',
    ملاحظات: '',
    ...over
  }
});

test('الربط التلقائي يتعرف على أعمدة النموذج', () => {
  assert.equal(mapping.national_id, 'الرقم الوطني');
  assert.equal(mapping.full_name, 'اسم الطالب');
  assert.equal(mapping.uniform_required, 'هل الزي مطلوب؟');
});

test('الصف السليم يُقرأ جاهزًا مع حفظ الأصفار', () => {
  const [out] = validateRows([row(2)], mapping);
  assert.equal(out.status, 'ready');
  assert.equal(out.data.national_id, '0012345678901');
  assert.equal(out.data.guardian_phone, '0912345678');
  assert.equal(out.data.uniform_required, true);
  assert.equal(out.data.tuition_fee, '2000.00');
});

test('اكتشاف التكرار داخل الملف', () => {
  const out = validateRows([row(2), row(3)], mapping);
  assert.equal(out[0].status, 'ready');
  assert.equal(out[1].status, 'duplicate_in_file');
});

test('اكتشاف الموجود مسبقًا في قاعدة البيانات', () => {
  const [out] = validateRows([row(2)], mapping, { existingIds: new Set(['0012345678901']) });
  assert.equal(out.status, 'exists');
});

test('اكتشاف الاسم المفقود والرقم الوطني المفقود', () => {
  const [noName] = validateRows([row(2, { 'اسم الطالب': '' })], mapping);
  assert.equal(noName.status, 'missing');
  const [noId] = validateRows([row(3, { 'الرقم الوطني': '' })], mapping);
  assert.equal(noId.status, 'missing');
});

test('اكتشاف المبالغ السالبة والقيم غير الرقمية', () => {
  const [neg] = validateRows([row(2, { 'الرسوم الدراسية': '-100' })], mapping);
  assert.equal(neg.status, 'error');
  const [bad] = validateRows([row(3, { 'رسوم التسجيل': 'مية وخمسين' })], mapping);
  assert.equal(bad.status, 'error');
});

test('الخصم الأكبر من الرسوم الدراسية مرفوض', () => {
  const [out] = validateRows([row(2, { الخصم: '5000' })], mapping);
  assert.equal(out.status, 'error');
  assert.match(out.issues.join(' '), /الخصم أكبر/);
});

test('«لا» في عمود الزي تعني أن الزي غير مطلوب', () => {
  const [out] = validateRows([row(2, { 'هل الزي مطلوب؟': 'لا' })], mapping);
  assert.equal(out.data.uniform_required, false);
});

test('الصف الدراسي يُربط برقمه إن كان معرّفًا', () => {
  const [out] = validateRows([row(2)], mapping, { classesByName: { الأول: 7 } });
  assert.equal(out.data.class_id, 7);
});
