/**
 * اختبار كلمة المرور واسم المستخدم — يتحقق فعليًا أن التغيير يعمل والدخول به يعمل،
 * وأن القديم لم يعد يعمل.
 *   npm start   ثم   node server/test/account.mjs
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const uid = Date.now().toString().slice(-6);
const login = (username, password) => call('/auth/login', { method: 'POST', body: { username, password } });

/* ---------------- تهيئة: مستخدم اختبار ---------------- */
section('التهيئة');
const admin = await login(ADMIN.username, ADMIN.password);
ok('دخول المدير', admin.status === 200, JSON.stringify(admin.data).slice(0, 120));
const A = admin.data.token;

const roles = await call('/users/roles', { token: A });
const accountantRole = roles.data.roles.find((r) => r.code === 'accountant').id;

const USER1 = `pwtest${uid}`;
const PASS1 = 'FirstPass@123';
const created = await call('/users', {
  method: 'POST', token: A,
  body: { full_name: 'موظف اختبار كلمة المرور', username: USER1, password: PASS1, role_id: accountantRole }
});
ok('إنشاء مستخدم بكلمة مرور', created.status === 201);
ok('المستخدم الجديد مطالَب بتغيير كلمة المرور عند أول دخول', created.data.must_change_password === true);

/* ---------------- كلمة المرور ---------------- */
section('كلمة المرور');
const first = await login(USER1, PASS1);
ok('1) الدخول بكلمة المرور التي أنشأها المدير يعمل', first.status === 200, JSON.stringify(first.data).slice(0, 120));
const U = first.data.token;
ok('   الواجهة تعرف أنه يجب تغيير كلمة المرور', first.data.user.must_change_password === true);

const wrongCurrent = await call('/auth/change-password', {
  method: 'POST', token: U, body: { current_password: 'خطأ', new_password: 'NewPass@456' }
});
ok('2) لا يقبل تغيير كلمة المرور بكلمة حالية خاطئة', wrongCurrent.status === 400);

const tooShort = await call('/auth/change-password', {
  method: 'POST', token: U, body: { current_password: PASS1, new_password: '123' }
});
ok('3) يرفض كلمة مرور أقصر من 8 أحرف', tooShort.status === 400);

const PASS2 = 'SecondPass@456';
const changed = await call('/auth/change-password', {
  method: 'POST', token: U, body: { current_password: PASS1, new_password: PASS2 }
});
ok('4) تغيير كلمة المرور ينجح', changed.status === 200 && changed.data.ok === true, JSON.stringify(changed.data).slice(0, 120));
ok('   يعيد توكنًا جديدًا فلا تنقطع الجلسة', !!changed.data.token);
ok('   ويرفع علامة «يجب تغيير كلمة المرور»', changed.data.user.must_change_password === false);

const oldPass = await login(USER1, PASS1);
ok('5) كلمة المرور القديمة لم تعد تعمل', oldPass.status === 401);

const newPass = await login(USER1, PASS2);
ok('6) الدخول بكلمة المرور الجديدة يعمل', newPass.status === 200);
const U2 = newPass.data.token;

const stillWorks = await call('/students?size=1', { token: U2 });
ok('   الصلاحيات كما هي بعد التغيير', stillWorks.status === 200);

/* ---------------- اسم المستخدم ---------------- */
section('اسم المستخدم');
const USER2 = `renamed${uid}`;

const noPassword = await call('/auth/change-username', {
  method: 'POST', token: U2, body: { new_username: USER2 }
});
ok('7) لا يقبل تغيير اسم المستخدم بلا كلمة مرور', noPassword.status === 400);

const badChars = await call('/auth/change-username', {
  method: 'POST', token: U2, body: { new_username: 'اسم عربي', password: PASS2 }
});
ok('8) يرفض اسم مستخدم بحروف غير مسموحة', badChars.status === 400);

const taken = await call('/auth/change-username', {
  method: 'POST', token: U2, body: { new_username: ADMIN.username, password: PASS2 }
});
ok('9) يرفض اسم مستخدم محجوز لشخص آخر', taken.status === 409, JSON.stringify(taken.data).slice(0, 100));

const renamed = await call('/auth/change-username', {
  method: 'POST', token: U2, body: { new_username: USER2, password: PASS2 }
});
ok('10) تغيير اسم المستخدم ينجح', renamed.status === 200 && renamed.data.user.username === USER2,
  JSON.stringify(renamed.data).slice(0, 140));

const oldUser = await login(USER1, PASS2);
ok('11) الاسم القديم لم يعد يعمل', oldUser.status === 401);

const newUser = await login(USER2, PASS2);
ok('12) الدخول بالاسم الجديد وكلمة المرور نفسها يعمل', newUser.status === 200);
const U3 = newUser.data.token;

/* ---------------- المدير يغيّر لغيره ---------------- */
section('صلاحيات المدير');
const USER3 = `byadmin${uid}`;
const PASS3 = 'AdminSet@789';
const byAdmin = await call(`/users/${created.data.id}`, {
  method: 'PATCH', token: A, body: { username: USER3, password: PASS3 }
});
ok('13) المدير يغيّر اسم مستخدم وكلمة مرور موظف', byAdmin.status === 200 && byAdmin.data.username === USER3,
  JSON.stringify(byAdmin.data).slice(0, 120));

const adminSet = await login(USER3, PASS3);
ok('14) الموظف يدخل بالبيانات التي عيّنها المدير', adminSet.status === 200);
ok('   ويُطالب بتغيير كلمة المرور لأن المدير هو من عيّنها', adminSet.data.user.must_change_password === true);

const notAdmin = await call(`/users/${created.data.id}`, {
  method: 'PATCH', token: adminSet.data.token, body: { username: 'hacker' + uid }
});
ok('15) موظف عادي لا يستطيع تغيير أسماء المستخدمين', notAdmin.status === 403);

/* ---------------- التسجيل في سجل العمليات ---------------- */
section('سجل العمليات');
const audit = await call('/audit?q=' + encodeURIComponent('تغيير اسم المستخدم'), { token: A });
ok('16) تغيير اسم المستخدم مسجّل بالاسم القديم والجديد',
  audit.data.rows.some((r) => r.description.includes(USER1) && r.description.includes(USER2)),
  JSON.stringify(audit.data.rows[0] || {}).slice(0, 160));

const auditPw = await call('/audit?q=' + encodeURIComponent('تغيير كلمة المرور'), { token: A });
ok('17) تغيير كلمة المرور مسجّل باسم منفّذه', auditPw.data.rows.length > 0);
ok('   ولا تظهر كلمة المرور نفسها في السجل إطلاقًا',
  !JSON.stringify(auditPw.data.rows).includes(PASS2) && !JSON.stringify(auditPw.data.rows).includes(PASS3));

/* ---------------- القفل بعد المحاولات الخاطئة ---------------- */
section('الحماية من التخمين');
const wrongTries = [];
for (let i = 0; i < 7; i++) wrongTries.push(await login(USER3, 'wrong-password'));
const locked = wrongTries.some((r) => /مقفل|قفل/.test(r.data.message || ''));
ok('18) الحساب يُقفل مؤقتًا بعد تكرار المحاولات الخاطئة', locked,
  JSON.stringify(wrongTries[wrongTries.length - 1].data).slice(0, 120));

/* ---------------- تنظيف ---------------- */
await call(`/users/${created.data.id}`, { method: 'PATCH', token: A, body: { active: false } });

console.log(`\n  النتيجة: ${pass} نجحت · ${fail} فشلت\n`);
process.exit(fail ? 1 : 0);
