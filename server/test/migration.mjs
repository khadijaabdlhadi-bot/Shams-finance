/**
 * اختبار نقل النظام من جهاز إلى جهاز — يتحقق أن **كل شيء** ينتقل:
 * الطلاب، الأرقام الوطنية بأصفارها، الرسوم، الدفعات، الإيصالات، الأقساط، المستخدمون
 * وكلمات مرورهم، الصلاحيات، الإعدادات، سجل العمليات، سجل استيراد Excel،
 * و**عدّادات الترقيم** حتى لا يتكرر رقم إيصال بعد النقل.
 *
 *   npm start   ثم   node server/test/migration.mjs
 */
const BASE = process.env.BASE || 'http://localhost:8080/api';
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'Admin@2026' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}  ${extra}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

async function call(p, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json().catch(() => ({})) : await res.text() };
}

const uid = Date.now().toString().slice(-6);
const login = (u, p) => call('/auth/login', { method: 'POST', body: { username: u, password: p } });

/* ============ 1) الجهاز القديم: ندخل بيانات كاملة ============ */
section('الجهاز القديم — إدخال البيانات');

const admin = await login(ADMIN.username, ADMIN.password);
const A = admin.data.token;
ok('دخول المدير', admin.status === 200);

// موظف بكلمة مرور معروفة — لنتأكد أنها تعمل بعد النقل
const roles = await call('/users/roles', { token: A });
const accId = roles.data.roles.find((r) => r.code === 'accountant').id;
const EMP = `mig${uid}`; const EMP_PASS = 'Migrate@1234';
const emp = await call('/users', {
  method: 'POST', token: A,
  body: { full_name: 'موظف النقل', username: EMP, password: EMP_PASS, role_id: accId }
});
ok('إنشاء موظف على الجهاز القديم', emp.status === 201);

// إعداد مخصص — لنتأكد أن الإعدادات تنتقل
const CUSTOM_FOOTER = `نص اختبار النقل ${uid}`;
await call('/settings', { method: 'PUT', token: A, body: { receipt_footer: CUSTOM_FOOTER } });

// طالب برقم وطني فيه أصفار في البداية
const NID = `000${uid}77`;
const student = await call('/students', {
  method: 'POST', token: A,
  body: {
    national_id: NID, full_name: `طالب النقل ${uid}`, guardian_phone: '0912000777',
    tuition_fee: 3000, registration_fee: 200, uniform_required: true, uniform_fee: 150, discount: 100
  }
});
ok('إضافة طالب برقم وطني يبدأ بأصفار', student.status === 201 && student.data.student.national_id === NID,
  student.data.student?.national_id);
const studentId = student.data.student.id;

// قسط + دفعتان (واحدة تُلغى)
await call(`/students/${studentId}/installments`, {
  method: 'POST', token: A, body: { name_ar: 'القسط الأول', amount: '1000', due_date: '2026-10-01' }
});
const methods = await call('/settings/payment-methods', { token: A });
const cash = methods.data.find((m) => m.code === 'cash').id;

const pay1 = await call('/payments', { method: 'POST', token: A, body: { student_id: studentId, amount: '500', method_id: cash } });
const pay2 = await call('/payments', { method: 'POST', token: A, body: { student_id: studentId, amount: '300', method_id: cash } });
ok('تسجيل دفعتين وإصدار إيصالين', pay1.status === 201 && pay2.status === 201);

await call(`/payments/${pay2.data.payment.id}/void`, { method: 'POST', token: A, body: { reason: 'اختبار النقل' } });

const beforeProfile = await call(`/students/${studentId}`, { token: A });
const beforeBalance = beforeProfile.data.balance;
ok('الرصيد قبل النقل محسوب بعد الإلغاء', beforeBalance.total_paid === '500.00', JSON.stringify(beforeBalance));

const lastReceipt = pay2.data.receipt_number;
const beforeCounts = (await call('/backup/verify', { token: A })).data;

/* ============ 2) تجهيز ملف النقل ============ */
section('تجهيز ملف النقل');
const backup = await call('/backup', { method: 'POST', token: A });
ok('إنشاء ملف النقل (نسخة كاملة)', backup.status === 200, JSON.stringify(backup.data).slice(0, 120));
const file = backup.data.backup.filename;
ok('الملف يحتوي عدّادات تحقق', backup.data.backup.counts.students >= 1);

/* ============ 3) الجهاز الجديد: نحاكيه بتغيير كل شيء ثم الاسترجاع ============ */
section('الجهاز الجديد — محاكاة النقل');

// نغيّر البيانات كما لو أن الجهاز الجديد بدأ فارغًا/مختلفًا
await call('/settings', { method: 'PUT', token: A, body: { receipt_footer: 'نص جهاز آخر' } });
const extra = await call('/students', {
  method: 'POST', token: A, body: { national_id: `888${uid}99`, full_name: 'طالب لا يجب أن يبقى', tuition_fee: 500 }
});
ok('إدخال بيانات مختلفة (تحاكي جهازًا آخر)', extra.status === 201);

const restored = await call('/backup/restore', {
  method: 'POST', token: A, body: { filename: file, confirm: 'استرجاع', password: ADMIN.password }
});
ok('تنفيذ النقل (استرجاع) بنجاح', restored.status === 200 && restored.data.ok === true,
  JSON.stringify(restored.data).slice(0, 160));

/* ============ 4) التحقق أن كل شيء انتقل ============ */
section('بعد النقل — هل بقي كل شيء؟');

const relogin = await login(ADMIN.username, ADMIN.password);
ok('1) المدير يدخل بنفس بياناته', relogin.status === 200);
const A2 = relogin.data.token;

const empLogin = await login(EMP, EMP_PASS);
ok('2) الموظف يدخل بنفس اسم المستخدم وكلمة المرور', empLogin.status === 200, JSON.stringify(empLogin.data).slice(0, 100));
ok('   وبنفس صلاحياته', (empLogin.data.user?.permissions || []).includes('payments.create')
  && !(empLogin.data.user?.permissions || []).includes('backup.restore'));

const found = await call(`/students?q=${NID}`, { token: A2 });
ok('3) الطالب موجود بالبحث بالرقم الوطني', found.data.rows?.length === 1);
ok('4) الأصفار في بداية الرقم الوطني محفوظة', found.data.rows?.[0]?.national_id === NID, found.data.rows?.[0]?.national_id);

const after = await call(`/students/${studentId}`, { token: A2 });
ok('5) الرسوم كما هي', after.data.fees.length === beforeProfile.data.fees.length);
ok('6) الخصم محفوظ', after.data.balance.total_discount === beforeBalance.total_discount,
  `${after.data.balance.total_discount} / ${beforeBalance.total_discount}`);
ok('7) الرصيد مطابق تمامًا قبل وبعد النقل',
  after.data.balance.total_due === beforeBalance.total_due
  && after.data.balance.total_paid === beforeBalance.total_paid
  && after.data.balance.balance === beforeBalance.balance,
  JSON.stringify(after.data.balance));
ok('8) الدفعات موجودة بأرقام إيصالاتها', after.data.payments.length === 2
  && after.data.payments.some((p) => p.receipt_number === pay1.data.receipt_number));
ok('9) الدفعة الملغاة ما زالت ملغاة بسببها', after.data.payments.some((p) => p.status === 'void' && p.void_reason === 'اختبار النقل'));
ok('10) الأقساط محفوظة', after.data.installments.length === 1 && after.data.installments[0].name_ar === 'القسط الأول');

const settings = await call('/settings', { token: A2 });
ok('11) إعدادات المدرسة رجعت كما كانت', settings.data.receipt_footer === CUSTOM_FOOTER, settings.data.receipt_footer);

const timeline = await call(`/students/${studentId}/timeline`, { token: A2 });
ok('12) سجل نشاط الطالب كامل', timeline.data.length >= 3, `${timeline.data.length} سجل`);

const auditAll = await call('/audit?size=1', { token: A2 });
ok('13) سجل العمليات العام محفوظ', auditAll.data.total >= beforeCounts.audit_logs, `${auditAll.data.total} / ${beforeCounts.audit_logs}`);

const gone = await call(`/students?q=888${uid}99`, { token: A2 });
ok('14) بيانات الجهاز الآخر لم تبقَ (النقل كامل وليس دمجًا)', gone.data.rows.length === 0);

/* ============ 5) الأهم: الترقيم يكمل ولا يتكرر ============ */
section('استمرار الترقيم بعد النقل');

const newPay = await call('/payments', {
  method: 'POST', token: A2, body: { student_id: studentId, amount: '100', method_id: cash }
});
ok('15) تسجيل دفعة جديدة بعد النقل ينجح', newPay.status === 201, JSON.stringify(newPay.data).slice(0, 120));

const seq = (n) => Number(String(n).split('-').pop());
ok('16) رقم الإيصال يكمل من حيث توقف ولا يعيد من واحد',
  seq(newPay.data.receipt_number) === seq(lastReceipt) + 1,
  `${lastReceipt} ← ${newPay.data.receipt_number}`);

const dup = await call('/receipts?q=' + newPay.data.receipt_number, { token: A2 });
ok('17) لا يوجد إيصالان بنفس الرقم', dup.data.rows.filter((r) => r.receipt_number === newPay.data.receipt_number).length === 1);

const newStudent = await call('/students', {
  method: 'POST', token: A2, body: { national_id: `777${uid}11`, full_name: 'طالب بعد النقل', tuition_fee: 100 }
});
ok('18) رقم الطالب الجديد يكمل الترقيم ولا يتصادم',
  newStudent.status === 201 && seq(newStudent.data.student.student_number) > 1,
  newStudent.data.student?.student_number);

const finalCounts = (await call('/backup/verify', { token: A2 })).data;
ok('19) إجمالي المحصّل بعد النقل = ما كان + الدفعة الجديدة',
  Number(finalCounts.total_collected) === Number(beforeCounts.total_collected) + 100,
  `${finalCounts.total_collected} / ${beforeCounts.total_collected}`);

console.log(`\n  النتيجة: ${pass} نجحت · ${fail} فشلت\n`);
process.exit(fail ? 1 : 0);
