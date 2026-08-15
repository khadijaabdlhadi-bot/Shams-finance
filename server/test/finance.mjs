/**
 * اختبار القسم المالي الجديد: تصدير Excel الحقيقي + نظام الأقساط.
 * ينفّذ حرفيًا السيناريوهات المطلوبة في بنود 31 و32 و33.
 *
 *   npm start   ثم   node server/test/finance.mjs
 */
import fs from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE || 'http://localhost:8080/api';
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'Admin@2026' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}  ${extra}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

async function call(p, { method = 'GET', body, token, binary = false } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (binary) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const uid = Date.now().toString().slice(-6);
const money = (n) => Number(n).toFixed(2);

const login = await call('/auth/login', { method: 'POST', body: ADMIN });
const A = login.data.token;
ok('دخول المدير', login.status === 200);

const methods = (await call('/settings/payment-methods', { token: A })).data;
const cash = methods.find((m) => m.code === 'cash').id;
const card = methods.find((m) => m.code === 'card').id;

/* ============ 1) خمسة طلاب حقيقيون ============ */
section('إضافة 5 طلاب والتأكد من بقائهم بعد التحديث (بند 4)');

const students = [];
for (let i = 1; i <= 5; i++) {
  const out = await call('/students', {
    method: 'POST', token: A,
    body: {
      national_id: `00${uid}${String(i).padStart(2, '0')}`,
      full_name: `طالب اكسل ${uid}-${i}`,
      guardian_phone: `091${uid}${i}`,
      tuition_fee: 1000 * i, registration_fee: 100, uniform_required: i % 2 === 0,
      uniform_fee: 120, extra_fee: 0, discount: i === 5 ? 50 : 0
    }
  });
  if (out.status === 201) students.push(out.data.student);
}
ok('1) أُضيف 5 طلاب وحُفظوا في قاعدة البيانات', students.length === 5, `${students.length}`);

// دفعات: طالب مسدد بالكامل، وطالبان جزئيًا، واثنان بلا دفع
await call('/payments', { method: 'POST', token: A, body: { student_id: students[0].id, amount: '1220', method_id: cash } });
await call('/payments', { method: 'POST', token: A, body: { student_id: students[1].id, amount: '500', method_id: card } });
await call('/payments', { method: 'POST', token: A, body: { student_id: students[2].id, amount: '300', method_id: cash } });

// «Refresh»: نعيد القراءة من الخادم من الصفر
const reread = await call(`/students?q=${uid}&size=50`, { token: A });
ok('2) الطلاب ما زالوا موجودين بعد إعادة القراءة (Refresh)', reread.data.rows.length === 5, `${reread.data.rows.length}`);
ok('3) الأصفار في بداية الرقم الوطني محفوظة في القاعدة',
  reread.data.rows.every((s) => s.national_id.startsWith('00')), reread.data.rows[0]?.national_id);

const byName = Object.fromEntries(reread.data.rows.map((s) => [s.full_name, s]));

/* ============ 2) تصدير Excel حقيقي ============ */
section('تصدير Excel من قاعدة البيانات (بنود 2 و4 و33)');

const template = await call('/excel/template', { token: A, binary: true });
ok('4) «تحميل نموذج Excel» ينزّل قالبًا (وظيفة مستقلة)', template.status === 200 && template.buffer.length > 3000);

const exportRes = await call('/excel/students/export.xlsx', { token: A, binary: true });
ok('5) «تصدير بيانات الطلاب» ينجح', exportRes.status === 200 && exportRes.buffer.length > 3000, `status=${exportRes.status}`);

const file = `/tmp/export-${uid}.xlsx`;
fs.writeFileSync(file, exportRes.buffer);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet('الطلاب');
ok('6) الملف يفتح ويحتوي ورقة «الطلاب»', !!ws);

const headerRow = ws.getRow(3).values.filter(Boolean).map(String);
ok('7) الأعمدة المطلوبة موجودة',
  ['رقم الطالب', 'الرقم الوطني', 'اسم الطالب', 'هاتف ولي الأمر', 'الصف', 'إجمالي المستحق', 'إجمالي المدفوع', 'إجمالي المتبقي', 'حالة الدفع']
    .every((h) => headerRow.includes(h)),
  headerRow.join('|').slice(0, 120));

const idx = (label) => headerRow.indexOf(label) + 1;
const cellText = (row, label) => {
  const c = row.getCell(idx(label)).value;
  return c === null || c === undefined ? '' : (typeof c === 'object' ? String(c.result ?? c.text ?? '') : String(c));
};

const dataRows = [];
ws.eachRow((row, n) => { if (n > 3 && cellText(row, 'اسم الطالب')) dataRows.push(row); });
const mine = dataRows.filter((row) => cellText(row, 'اسم الطالب').includes(`اكسل ${uid}`));

ok('8) الطلاب الخمسة موجودون في الملف — الملف ليس فارغًا', mine.length === 5, `${mine.length} من ${dataRows.length} صف`);
ok('9) الأسماء صحيحة',
  mine.every((row) => byName[cellText(row, 'اسم الطالب')]), mine.map((r) => cellText(r, 'اسم الطالب')).join('، ').slice(0, 80));
ok('10) الأرقام الوطنية صحيحة وبأصفارها',
  mine.every((row) => {
    const s = byName[cellText(row, 'اسم الطالب')];
    return cellText(row, 'الرقم الوطني') === s.national_id && cellText(row, 'الرقم الوطني').startsWith('00');
  }),
  mine.map((r) => cellText(r, 'الرقم الوطني')).join('، '));
ok('11) الهواتف صحيحة وبأصفارها',
  mine.every((row) => cellText(row, 'هاتف ولي الأمر') === byName[cellText(row, 'اسم الطالب')].guardian_phone));
ok('12) الأرقام المالية مطابقة تمامًا لما في النظام',
  mine.every((row) => {
    const s = byName[cellText(row, 'اسم الطالب')];
    return money(cellText(row, 'إجمالي المستحق')) === money(s.total_due)
      && money(cellText(row, 'إجمالي المدفوع')) === money(s.total_paid)
      && money(cellText(row, 'إجمالي المتبقي')) === money(s.balance);
  }),
  mine.map((r) => `${cellText(r, 'إجمالي المستحق')}/${cellText(r, 'إجمالي المدفوع')}`).join(' '));
ok('13) حالة الدفع مكتوبة بالعربية',
  mine.every((row) => ['مسدد بالكامل', 'مسدد جزئيًا', 'غير مسدد'].includes(cellText(row, 'حالة الدفع'))));

/* ============ 3) تصدير حسب الفلتر ============ */
section('تصدير النتائج المفلترة (بند 3 و33)');

const partialRes = await call('/excel/students/export.xlsx?payment_status=partial', { token: A, binary: true });
const pFile = `/tmp/export-partial-${uid}.xlsx`;
fs.writeFileSync(pFile, partialRes.buffer);
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile(pFile);
const ws2 = wb2.getWorksheet('الطلاب');
const head2 = ws2.getRow(3).values.filter(Boolean).map(String);
const statusIdx = head2.indexOf('حالة الدفع') + 1;

const partialRows = [];
ws2.eachRow((row, n) => {
  if (n <= 3) return;
  const val = row.getCell(statusIdx).value;
  if (val) partialRows.push(String(val));
});
ok('14) ملف «مسدد جزئيًا» يحتوي فقط على المسددين جزئيًا',
  partialRows.length > 0 && partialRows.every((s) => s === 'مسدد جزئيًا'),
  [...new Set(partialRows)].join('، '));

const apiPartial = await call('/students?payment_status=partial&size=200', { token: A });
ok('15) عدد الصفوف المصدَّرة = عدد ما تعرضه الشاشة بنفس الفلتر',
  partialRows.length === apiPartial.data.total, `${partialRows.length} / ${apiPartial.data.total}`);

const paidRes = await call('/excel/students/export.xlsx?payment_status=paid', { token: A, binary: true });
const wb3 = new ExcelJS.Workbook();
await wb3.xlsx.load(paidRes.buffer);
const ws3 = wb3.getWorksheet('الطلاب');
const sIdx = ws3.getRow(3).values.filter(Boolean).map(String).indexOf('حالة الدفع') + 1;
const paidRows = [];
ws3.eachRow((row, n) => { if (n > 3 && row.getCell(sIdx).value) paidRows.push(String(row.getCell(sIdx).value)); });
ok('16) ملف «مسدد بالكامل» يحتوي فقط على المسددين بالكامل',
  paidRows.length > 0 && paidRows.every((s) => s === 'مسدد بالكامل'), [...new Set(paidRows)].join('، '));

const auditExport = await call('/audit?action=excel_export', { token: A });
ok('17) عملية التصدير مسجّلة في سجل العمليات', auditExport.data.rows.length > 0,
  auditExport.data.rows[0]?.description?.slice(0, 60));

/* ============ 4) سيناريو الأقساط الإلزامي (بند 31) ============ */
section('سيناريو الأقساط المطلوب (بند 31)');

const st = (await call('/students', {
  method: 'POST', token: A,
  body: { national_id: `11${uid}01`, full_name: `طالب اختبار ${uid}`, tuition_fee: 5000, registration_fee: 0 }
})).data.student;

const inst = await call(`/students/${st.id}/installments`, {
  method: 'POST', token: A, body: { name_ar: 'القسط الأول', amount: '1000', due_date: '2026-10-01', notes: 'اختبار' }
});
ok('18) إنشاء القسط الأول بقيمة 1,000', inst.status === 201);
const instId = inst.data.id;

const readInst = async () => {
  const p = await call(`/students/${st.id}`, { token: A });
  return p.data.installments.find((i) => i.installment_id === instId || i.id === instId);
};

let cur = await readInst();
ok('19) المدفوع = 0 والمتبقي = 1,000 والحالة غير مدفوع',
  money(cur.paid) === '0.00' && money(cur.remaining) === '1000.00' && ['unpaid', 'due', 'late'].includes(cur.status),
  JSON.stringify({ paid: cur.paid, remaining: cur.remaining, status: cur.status }));

const pay1 = await call('/payments', {
  method: 'POST', token: A, body: { student_id: st.id, installment_id: instId, amount: '400', method_id: cash }
});
ok('20) تسجيل 400 نقدًا على القسط', pay1.status === 201, JSON.stringify(pay1.data).slice(0, 120));

cur = await readInst();
ok('21) المدفوع = 400 · المتبقي = 600 · الحالة «مدفوع جزئيًا»',
  money(cur.paid) === '400.00' && money(cur.remaining) === '600.00' && cur.status === 'partial',
  JSON.stringify({ paid: cur.paid, remaining: cur.remaining, status: cur.status }));

const pay2 = await call('/payments', {
  method: 'POST', token: A, body: { student_id: st.id, installment_id: instId, amount: '600', method_id: card }
});
ok('22) تسجيل 600 بالبطاقة على نفس القسط', pay2.status === 201);

cur = await readInst();
ok('23) المدفوع = 1,000 · المتبقي = 0 · الحالة «مدفوع بالكامل»',
  money(cur.paid) === '1000.00' && money(cur.remaining) === '0.00' && cur.status === 'paid',
  JSON.stringify({ paid: cur.paid, remaining: cur.remaining, status: cur.status }));

ok('24) الدفعتان أنشأتا إيصالين منفصلين',
  pay1.data.receipt_number !== pay2.data.receipt_number && !!pay1.data.receipt_id && !!pay2.data.receipt_id,
  `${pay1.data.receipt_number} / ${pay2.data.receipt_number}`);

const extra = await call('/payments', {
  method: 'POST', token: A, body: { student_id: st.id, installment_id: instId, amount: '100', method_id: cash }
});
ok('25) رفض دفعة إضافية على قسط مدفوع بالكامل',
  extra.status === 400 && /مدفوع بالكامل/.test(extra.data.message), JSON.stringify(extra.data).slice(0, 120));

const log = await call(`/students/${st.id}/installments/${instId}/payments`, { token: A });
ok('26) سجل دفعات القسط يعرض الدفعتين بطريقتيهما وإيصاليهما',
  log.data.payments.length === 2
  && log.data.payments.some((p) => p.method_name === 'نقدًا' && money(p.amount) === '400.00')
  && log.data.payments.some((p) => p.method_name === 'بطاقة' && money(p.amount) === '600.00'),
  JSON.stringify(log.data.payments.map((p) => [p.amount, p.method_name])));

const receipt = await call(`/receipts/${pay1.data.receipt_id}`, { token: A });
ok('27) الإيصال يحمل بيانات القسط (الاسم والقيمة والمتبقي منه)',
  receipt.data.snapshot.installment?.name === 'القسط الأول'
  && money(receipt.data.snapshot.installment.amount) === '1000.00'
  && money(receipt.data.snapshot.installment.remaining_after) === '600.00',
  JSON.stringify(receipt.data.snapshot.installment));

/* ============ 5) تعديل القسط (بند 32) ============ */
section('تعديل القسط (بند 32)');

const st2 = (await call('/students', {
  method: 'POST', token: A,
  body: { national_id: `22${uid}02`, full_name: `طالب تعديل ${uid}`, tuition_fee: 5000, registration_fee: 0 }
})).data.student;

const inst2 = (await call(`/students/${st2.id}/installments`, {
  method: 'POST', token: A, body: { name_ar: 'قسط التعديل', amount: '1000' }
})).data;

await call('/payments', {
  method: 'POST', token: A, body: { student_id: st2.id, installment_id: inst2.id, amount: '600', method_id: cash }
});

const up = await call(`/students/${st2.id}/installments/${inst2.id}`, {
  method: 'PATCH', token: A, body: { amount: '1200', reason: 'زيادة معتمدة من الإدارة' }
});
ok('28) رفع قيمة القسط من 1,000 إلى 1,200 مسموح', up.status === 200);

const after2 = up.data.installments.find((i) => i.installment_id === inst2.id);
ok('29) بعد التعديل: المدفوع = 600 والمتبقي = 600',
  money(after2.paid) === '600.00' && money(after2.remaining) === '600.00',
  JSON.stringify({ paid: after2.paid, remaining: after2.remaining }));

const down = await call(`/students/${st2.id}/installments/${inst2.id}`, {
  method: 'PATCH', token: A, body: { amount: '500' }
});
ok('30) رفض خفض قيمة القسط تحت المدفوع (500 < 600)',
  down.status === 400 && /أقل من المبلغ المدفوع/.test(down.data.message), JSON.stringify(down.data).slice(0, 140));

const changes = await call(`/students/${st2.id}/installments/${inst2.id}/payments`, { token: A });
ok('31) تعديل القيمة مسجّل بالقيمة القديمة والجديدة والمنفّذ',
  changes.data.changes.length >= 1
  && money(changes.data.changes[0].old_amount) === '1000.00'
  && money(changes.data.changes[0].new_amount) === '1200.00'
  && !!changes.data.changes[0].changed_by_name,
  JSON.stringify(changes.data.changes[0] || {}).slice(0, 140));

const auditInst = await call('/audit?action=installment_update', { token: A });
ok('32) التعديل مسجّل في سجل العمليات', auditInst.data.rows.length > 0,
  auditInst.data.rows[0]?.description?.slice(0, 70));

/* ============ 6) الحالة الإجمالية والخزينة ============ */
section('الحالة الإجمالية والخزينة');

const profile = await call(`/students/${st.id}`, { token: A });
ok('33) حالة الطالب تُحسب من كل الرسوم لا من قسط واحد',
  money(profile.data.balance.total_paid) === '1000.00'
  && profile.data.balance.payment_status === 'partial',
  JSON.stringify(profile.data.balance));

const treasury = await call('/finance/treasury', { token: A });
ok('34) الخزينة ترصد الدفعات وتفصلها حسب طريقة الدفع',
  Number(treasury.data.balance.total) > 0 && treasury.data.by_method.some((m) => Number(m.value) > 0));
ok('35) حركات الخزينة تعرض دفعات باسم الطالب والموظف',
  treasury.data.movements.some((m) => m.student_name && m.user_name && m.direction === 'in'));

const finStudents = await call('/finance/students?q=' + encodeURIComponent(`طالب اختبار ${uid}`), { token: A });
ok('36) شاشة «الطلبة والمدفوعات» تعرض القسط الحالي وآخر دفعة',
  finStudents.data.rows.length === 1 && !!finStudents.data.rows[0].last_payment,
  JSON.stringify(finStudents.data.rows[0]?.last_payment || {}).slice(0, 100));

const debts = await call('/finance/debts', { token: A });
ok('37) صفحة الديون تعرض من عليهم متبقٍ فقط',
  debts.data.rows.length > 0 && debts.data.rows.every((x) => Number(x.balance) > 0));

const finInst = await call('/finance/installments', { token: A });
ok('38) شاشة الأقساط العامة تعرض أقساط كل الطلاب مع حالتها',
  finInst.data.rows.length >= 2 && finInst.data.rows.every((x) => x.status && x.percent !== undefined));

/* ============ 7) البيانات القديمة لم تُمس ============ */
section('سلامة البيانات القديمة');
const counts = await call('/backup/verify', { token: A });
ok('39) الطلاب القدامى ما زالوا موجودين', Number(counts.data.students) >= 41 + 7, `${counts.data.students}`);
ok('40) الدفعات القديمة ما زالت موجودة', Number(counts.data.payments) >= 65, `${counts.data.payments}`);

console.log(`\n  النتيجة: ${pass} نجحت · ${fail} فشلت\n`);
process.exit(fail ? 1 : 0);
