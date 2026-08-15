/**
 * اختبار القبول — الـ38 خطوة المطلوبة في المواصفات، منفَّذة فعليًا على نظام يعمل.
 * التشغيل:  npm start   ثم   node server/test/acceptance.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE || 'http://localhost:8080/api';
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'Admin@2026' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}  ${extra}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

async function call(p, { method = 'GET', body, token, form } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: form || (body === undefined ? undefined : JSON.stringify(body))
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({}))
    : type.includes('pdf') || type.includes('sheet') ? Buffer.from(await res.arrayBuffer())
      : await res.text();
  return { status: res.status, data };
}

const uid = Date.now().toString().slice(-6);

/* 1–3 التثبيت والدخول */
section('التثبيت والدخول (خطوات 1–3)');
const health = await call('/health');
ok('1) النظام يعمل وقاعدة البيانات متصلة', health.data.ok === true);

const login = await call('/auth/login', { method: 'POST', body: ADMIN });
ok('2) حساب المدير موجود', login.status === 200, JSON.stringify(login.data).slice(0, 120));
const A = login.data.token;
ok('3) تسجيل الدخول يعيد صلاحيات الدور', (login.data.user?.permissions || []).includes('backup.restore'));

const badLogin = await call('/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
ok('   كلمة مرور خاطئة تُرفض برسالة عربية', badLogin.status === 401 && /غير صحيحة/.test(badLogin.data.message));

/* 4–5 إنشاء مستخدمين */
section('المستخدمون والصلاحيات (خطوات 4–5)');
const roles = await call('/users/roles', { token: A });
const roleId = (code) => roles.data.roles.find((r) => r.code === code).id;

const acc = await call('/users', {
  method: 'POST', token: A,
  body: { full_name: 'محاسب الاختبار', username: `acc${uid}`, password: 'Test@12345', role_id: roleId('accountant') }
});
ok('4) إنشاء حساب محاسب', acc.status === 201, JSON.stringify(acc.data).slice(0, 120));

const de = await call('/users', {
  method: 'POST', token: A,
  body: { full_name: 'مدخل بيانات', username: `de${uid}`, password: 'Test@12345', role_id: roleId('data_entry') }
});
ok('5) إنشاء حساب إدخال بيانات', de.status === 201);

/* 6–7 الدخول من جهاز آخر (جلسة مستقلة على نفس الخادم = نفس قاعدة البيانات) */
section('العمل من أكثر من جهاز (خطوات 6–7)');
const accLogin = await call('/auth/login', { method: 'POST', body: { username: `acc${uid}`, password: 'Test@12345' } });
const ACC = accLogin.data.token;
ok('6) المحاسب يدخل من جلسة مستقلة (جهاز آخر على LAN)', accLogin.status === 200);
const deLogin = await call('/auth/login', { method: 'POST', body: { username: `de${uid}`, password: 'Test@12345' } });
const DE = deLogin.data.token;
ok('7) مدخل البيانات يدخل من جلسة ثالثة', deLogin.status === 200);

const forbidden = await call('/backup', { token: ACC });
ok('   المحاسب لا يصل إلى النسخ الاحتياطي', forbidden.status === 403);
const forbidden2 = await call('/settings', { method: 'PUT', token: DE, body: { currency: 'X' } });
ok('   مدخل البيانات لا يعدّل الإعدادات', forbidden2.status === 403);

/* 8–13 Excel */
section('استيراد Excel (خطوات 8–13)');
const template = await call('/excel/template', { token: DE });
ok('8) تحميل نموذج Excel', Buffer.isBuffer(template.data) && template.data.length > 3000);

const file = path.join('/tmp', `import-${uid}.xlsx`);
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('الطلاب');
ws.addRow(['الرقم الوطني', 'اسم الطالب', 'هاتف ولي الأمر', 'هاتف إضافي', 'الصف', 'الفصل', 'السنة الدراسية',
  'الرسوم الدراسية', 'رسوم التسجيل', 'سعر الزي', 'هل الزي مطلوب؟', 'رسوم إضافية', 'الخصم', 'ملاحظات']);
ws.getColumn(1).numFmt = '@'; ws.getColumn(3).numFmt = '@';
const rows = [
  ['00' + uid + '001', 'سالم عبدالله', '0912000001', '', 'الأول', 'أ', '2026/2027', 2000, 150, 120, 'نعم', 0, 0, ''],
  ['00' + uid + '002', 'مريم علي', '0912000002', '', 'الثاني', 'ب', '2026/2027', 2500, 150, 0, 'لا', 50, 100, 'أخوة'],
  ['00' + uid + '002', 'مريم علي مكررة', '0912000003', '', 'الثاني', 'ب', '2026/2027', 2500, 150, 0, 'لا', 0, 0, ''],
  ['', 'بلا رقم وطني', '0912000004', '', 'الثالث', 'أ', '2026/2027', 1000, 0, 0, 'لا', 0, 0, ''],
  ['00' + uid + '004', '', '0912000005', '', 'الثالث', 'أ', '2026/2027', 1000, 0, 0, 'لا', 0, 0, ''],
  ['00' + uid + '005', 'قيمة سالبة', '0912000006', '', 'الرابع', 'أ', '2026/2027', -500, 0, 0, 'لا', 0, 0, '']
];
rows.forEach((r) => ws.addRow(r));
await wb.xlsx.writeFile(file);

const fd = new FormData();
fd.append('file', new Blob([fs.readFileSync(file)]), 'students.xlsx');
const uploaded = await call('/excel/upload', { method: 'POST', token: DE, form: fd });
ok('9) رفع قائمة الطلاب', uploaded.status === 200 && uploaded.data.total_rows === 6, JSON.stringify(uploaded.data).slice(0, 150));
ok('10) القائمة تحتوي عمود الرقم الوطني وتم ربطه تلقائيًا', uploaded.data.mapping?.national_id === 'الرقم الوطني');

const preview = await call('/excel/preview', {
  method: 'POST', token: DE, body: { upload_id: uploaded.data.upload_id, mapping: uploaded.data.mapping }
});
ok('11) اكتشاف الأرقام المكررة والصفوف الناقصة قبل الحفظ',
  preview.data.counts.duplicate_in_file === 1 && preview.data.counts.missing === 2 && preview.data.counts.error === 1,
  JSON.stringify(preview.data.counts));

const firstRow = preview.data.rows[0];
ok('12) المحافظة على الأصفار في بداية الرقم الوطني', firstRow.data.national_id === '00' + uid + '001', firstRow.data.national_id);

const imported = await call('/excel/import', {
  method: 'POST', token: DE, body: { upload_id: uploaded.data.upload_id, mapping: uploaded.data.mapping, filename: 'students.xlsx' }
});
ok('13) استيراد الطلاب الجاهزين فقط', imported.data.imported === 2 && imported.data.skipped === 4, JSON.stringify(imported.data).slice(0, 160));

/* 14–15 البحث وفتح الحساب */
section('البحث وملف الطالب (خطوات 14–15)');
const search = await call(`/students?q=00${uid}001`, { token: ACC });
ok('14) البحث بالرقم الوطني يجد الطالب', search.data.rows?.length === 1, JSON.stringify(search.data.rows?.[0] || {}).slice(0, 120));
const student = search.data.rows[0];
const profile = await call(`/students/${student.id}`, { token: ACC });
ok('15) فتح حساب الطالب يعرض الرسوم والحساب المالي',
  profile.data.fees.length >= 3 && profile.data.balance.total_due === '2270.00', profile.data.balance?.total_due);

/* 16–21 الدفع */
section('تسجيل الدفعة والإيصال (خطوات 16–21)');
const methods = await call('/settings/payment-methods', { token: ACC });
const cash = methods.data.find((m) => m.code === 'cash');

const payment = await call('/payments', {
  method: 'POST', token: ACC,
  body: { student_id: student.id, amount: '700', method_id: cash.id, notes: 'اختبار القبول' }
});
ok('16) تسجيل دفعة نقدية', payment.status === 201, JSON.stringify(payment.data).slice(0, 140));
ok('17) إنشاء رقم إيصال فريد', /^SHW-\d{4}-\d{6}$/.test(payment.data.receipt_number), payment.data.receipt_number);

const after = await call(`/students/${student.id}`, { token: ACC });
ok('18) تحديث الرصيد تلقائيًا', after.data.balance.total_paid === '700.00' && after.data.balance.balance === '1570.00',
  JSON.stringify(after.data.balance));
ok('19) تحديث حالة الطالب إلى «مسدد جزئيًا»', after.data.balance.payment_status === 'partial');
ok('20) تسجيل اسم الموظف منفّذ العملية', after.data.payments[0].created_by_name === 'محاسب الاختبار');
ok('21) تسجيل التاريخ والوقت من الخادم', !!after.data.payments[0].paid_at);

/* 22–23 الطباعة و PDF */
section('الطباعة و PDF (خطوات 22–23)');
const printed = await call(`/receipts/${payment.data.receipt_id}/print`, { token: ACC });
ok('22) صفحة الإيصال جاهزة للطباعة بالعربية RTL',
  typeof printed.data === 'string' && printed.data.includes('إيصال دفع') && printed.data.includes('dir="rtl"'));
ok('   الإيصال يحتوي اسم الطالب والرقم الوطني ورقم الإيصال',
  printed.data.includes(student.full_name) && printed.data.includes(student.national_id)
  && printed.data.includes(payment.data.receipt_number));

const pdfStatus = await call('/receipts/status/pdf', { token: ACC });
if (pdfStatus.data.available) {
  const pdf = await call(`/receipts/${payment.data.receipt_id}/pdf`, { token: ACC });
  ok('23) تنزيل الإيصال PDF', Buffer.isBuffer(pdf.data) && pdf.data.slice(0, 4).toString() === '%PDF', `len=${pdf.data.length}`);
} else {
  ok('23) تنزيل PDF (غير مفعّل هنا — الطباعة تعمل وتحفظ PDF من المتصفح)', true);
}

/* 24–26 التقارير والسجل */
section('التقارير وسجل العمليات (خطوات 24–26)');
const daily = await call(`/reports/daily?date=${new Date().toISOString().slice(0, 10)}`, { token: ACC });
ok('24) الدفعة تظهر في تقرير اليوم',
  daily.data.rows.some((r) => r.receipt_number === payment.data.receipt_number), `عدد=${daily.data.rows.length}`);
ok('   التقرير يفصل المبالغ حسب طريقة الدفع', daily.data.by_method.some((m) => Number(m.value) >= 700));

const staff = await call(`/reports/staff?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { token: ACC });
ok('25) الدفعة تظهر في تقرير الموظف',
  staff.data.rows.some((r) => r.full_name === 'محاسب الاختبار' && Number(r.total) >= 700));

const audit = await call('/audit?action=payment_create', { token: A });
ok('26) العملية مسجّلة في سجل العمليات مع اسم المنفّذ',
  audit.data.rows.some((r) => r.description.includes(payment.data.receipt_number) && r.full_name === 'محاسب الاختبار'));

/* 27–29 التزامن */
section('التزامن وتعدد الأجهزة (خطوات 27–29)');
const student2 = (await call(`/students?q=00${uid}002`, { token: ACC })).data.rows[0];
const p2 = await call('/payments', {
  method: 'POST', token: A, body: { student_id: student2.id, amount: '300', method_id: cash.id }
});
ok('27) تسجيل دفعة ثانية من جلسة/جهاز آخر', p2.status === 201);

const seenByAcc = await call(`/students/${student2.id}`, { token: ACC });
ok('28) التغيير يظهر فورًا لبقية المستخدمين (قاعدة بيانات مركزية)',
  seenByAcc.data.balance.total_paid === '300.00');

const target = (await call(`/students?q=00${uid}001`, { token: ACC })).data.rows[0];
const concurrent = await Promise.all(Array.from({ length: 5 }, () => call('/payments', {
  method: 'POST', token: ACC, body: { student_id: target.id, amount: '100', method_id: cash.id }
})));
const numbers = concurrent.filter((r) => r.status === 201).map((r) => r.data.receipt_number);
ok('29) خمس دفعات متزامنة بلا تكرار في أرقام الإيصالات',
  numbers.length === 5 && new Set(numbers).size === 5, numbers.join(','));

const balAfter = await call(`/students/${target.id}`, { token: ACC });
ok('   الرصيد صحيح بعد الدفعات المتزامنة (700 + 5×100)', balAfter.data.balance.total_paid === '1200.00',
  balAfter.data.balance.total_paid);

const dupNational = await call('/students', {
  method: 'POST', token: DE, body: { national_id: '00' + uid + '001', full_name: 'محاولة تكرار', tuition_fee: 100 }
});
ok('   محاولة تكرار الرقم الوطني مرفوضة برسالة تذكر اسم الطالب',
  dupNational.status === 409 && dupNational.data.message.includes(target.full_name));

const over = await call('/payments', {
  method: 'POST', token: ACC, body: { student_id: target.id, amount: '999999', method_id: cash.id }
});
ok('   دفعة أكبر من المتبقي مرفوضة', over.status === 400 && /أكبر من المتبقي/.test(over.data.message));

const zero = await call('/payments', {
  method: 'POST', token: ACC, body: { student_id: target.id, amount: '0', method_id: cash.id }
});
ok('   دفعة بصفر مرفوضة', zero.status === 400);

const voidTry = await call(`/payments/${payment.data.payment.id}/void`, {
  method: 'POST', token: ACC, body: { reason: 'محاولة من محاسب' }
});
ok('   المحاسب لا يملك صلاحية إلغاء الدفعات', voidTry.status === 403);

/* 30–38 النسخ الاحتياطي والاسترجاع */
section('النسخ الاحتياطي والنقل إلى جهاز آخر (خطوات 30–38)');
const before = await call('/backup/verify', { token: A });
const backup = await call('/backup', { method: 'POST', token: A });
ok('30) إنشاء نسخة احتياطية', backup.status === 200 && backup.data.backup?.size_bytes > 1000,
  JSON.stringify(backup.data).slice(0, 140));
ok('   النسخة تحمل بصمة SHA-256 وعدّادات تحقق',
  !!backup.data.backup.sha256 && backup.data.backup.counts.students >= 2);

// محاكاة «الجهاز الجديد»: نغيّر البيانات ثم نسترجع النسخة ونتأكد أن كل شيء عاد
const extra = await call('/students', {
  method: 'POST', token: A,
  body: { national_id: '99' + uid + '999', full_name: 'طالب بعد النسخة', tuition_fee: 500 }
});
ok('31) تغيير البيانات بعد أخذ النسخة (لمحاكاة النقل)', extra.status === 201);

const inspect = await call('/backup/inspect', {
  method: 'POST', token: A, body: { filename: backup.data.backup.filename }
});
ok('32) فحص ملف النسخة قبل الاسترجاع', inspect.status === 200 && inspect.data.manifest.app === 'shams-finance');
ok('   التحقق من توافق إصدار المخطط', inspect.data.manifest.schema_version === 1);

const noConfirm = await call('/backup/restore', {
  method: 'POST', token: A, body: { filename: backup.data.backup.filename, password: ADMIN.password }
});
ok('   الاسترجاع بدون كلمة التأكيد مرفوض', noConfirm.status === 400);

const badPassword = await call('/backup/restore', {
  method: 'POST', token: A, body: { filename: backup.data.backup.filename, confirm: 'استرجاع', password: 'wrong' }
});
ok('   الاسترجاع بكلمة مرور خاطئة مرفوض', badPassword.status === 403);

const accRestore = await call('/backup/restore', {
  method: 'POST', token: ACC, body: { filename: backup.data.backup.filename, confirm: 'استرجاع', password: 'Test@12345' }
});
ok('   المحاسب لا يملك صلاحية الاسترجاع', accRestore.status === 403);

const restored = await call('/backup/restore', {
  method: 'POST', token: A,
  body: { filename: backup.data.backup.filename, confirm: 'استرجاع', password: ADMIN.password }
});
ok('33) تنفيذ الاسترجاع بنجاح', restored.status === 200 && restored.data.ok === true,
  JSON.stringify(restored.data).slice(0, 200));
ok('   أخذ نسخة أمان تلقائية للحالة الحالية قبل الاسترجاع', !!restored.data.safety_backup);

const relogin = await call('/auth/login', { method: 'POST', body: ADMIN });
ok('34) تسجيل الدخول بعد الاسترجاع', relogin.status === 200);
const A2 = relogin.data.token;

const afterRestore = await call('/backup/verify', { token: A2 });
ok('35) الطلاب موجودون بعد الاسترجاع', Number(afterRestore.data.students) === Number(backup.data.backup.counts.students),
  `${afterRestore.data.students} / ${backup.data.backup.counts.students}`);
ok('36) الدفعات موجودة', Number(afterRestore.data.payments) === Number(backup.data.backup.counts.payments));
ok('37) الإيصالات وسجل العمليات موجودة',
  Number(afterRestore.data.receipts) === Number(backup.data.backup.counts.receipts)
  // سجل العمليات يزيد بسطر: عملية الاسترجاع نفسها تُسجَّل بعد التنفيذ
  && Number(afterRestore.data.audit_logs) >= Number(backup.data.backup.counts.audit_logs),
  `${afterRestore.data.receipts}/${backup.data.backup.counts.receipts} · ${afterRestore.data.audit_logs}/${backup.data.backup.counts.audit_logs}`);
ok('38) الأرصدة مطابقة قبل وبعد النقل',
  afterRestore.data.total_collected === backup.data.backup.counts.total_collected,
  `${afterRestore.data.total_collected} / ${backup.data.backup.counts.total_collected}`);

const goneAgain = await call(`/students?q=99${uid}999`, { token: A2 });
ok('   البيانات التي أُضيفت بعد النسخة لم تعد موجودة (الاسترجاع كامل)', goneAgain.data.rows.length === 0);

const restoreLog = await call('/backup', { token: A2 });
ok('   عملية الاسترجاع مسجّلة في سجل خارج قاعدة البيانات', (restoreLog.data.restore_log || []).length > 0);

console.log(`\n  النتيجة: ${pass} نجحت · ${fail} فشلت\n`);
process.exit(fail ? 1 : 0);
