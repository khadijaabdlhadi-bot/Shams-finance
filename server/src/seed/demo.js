#!/usr/bin/env node
/**
 * بيانات تجريبية للتدريب والاختبار — ليست للاستخدام الفعلي.
 *
 *   npm run seed:demo              إضافة 24 طالبًا تجريبيًا مع رسوم ودفعات
 *   npm run seed:demo -- --clear   حذف البيانات التجريبية فقط (تبدأ أرقامها بـ 9999)
 *
 * كل الطلاب التجريبيين أرقامهم الوطنية تبدأ بـ 9999 حتى يسهل تمييزهم وحذفهم،
 * ولا يمكن أن تتعارض مع أرقام وطنية حقيقية.
 */
import { pool, one, many, tx } from '../db.js';
import { migrate } from '../migrate.js';
import { seed } from './seed.js';
import { createStudent } from '../services/students.js';
import { recordPayment } from '../services/payments.js';

const PREFIX = '9999';

const FIRST = ['محمد', 'أحمد', 'عبدالله', 'سالم', 'يوسف', 'خالد', 'عمر', 'إبراهيم',
  'فاطمة', 'مريم', 'عائشة', 'زينب', 'هدى', 'سارة', 'ليلى', 'نور'];
const LAST = ['الشريف', 'المصراتي', 'الزنتاني', 'الترهوني', 'الفيتوري', 'بن عمر', 'القذافي', 'الورفلي'];

const pick = (arr, i) => arr[i % arr.length];

async function clearDemo() {
  const students = await many(`SELECT id, full_name FROM students WHERE national_id LIKE '${PREFIX}%'`);
  if (!students.length) { console.log('  لا توجد بيانات تجريبية.'); return 0; }
  const ids = students.map((s) => s.id);
  await tx(async (c) => {
    await c.query('DELETE FROM audit_logs WHERE student_id = ANY($1)', [ids]);
    await c.query(`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE student_id = ANY($1))`, [ids]);
    await c.query('DELETE FROM receipts WHERE payment_id IN (SELECT id FROM payments WHERE student_id = ANY($1))', [ids]);
    await c.query('DELETE FROM payments WHERE student_id = ANY($1)', [ids]);
    await c.query('DELETE FROM student_fees WHERE enrollment_id IN (SELECT id FROM student_enrollments WHERE student_id = ANY($1))', [ids]);
    await c.query('DELETE FROM installments WHERE enrollment_id IN (SELECT id FROM student_enrollments WHERE student_id = ANY($1))', [ids]);
    await c.query('DELETE FROM student_enrollments WHERE student_id = ANY($1)', [ids]);
    await c.query('DELETE FROM students WHERE id = ANY($1)', [ids]);
  });
  console.log(`  ✓ حُذف ${students.length} طالبًا تجريبيًا وكل ما يتعلق بهم.`);
  return students.length;
}

async function run() {
  await migrate({ quiet: true });
  await seed({ quiet: true });

  if (process.argv.includes('--clear')) {
    await clearDemo();
    return;
  }

  const admin = await one(`SELECT u.id, u.username, u.full_name FROM users u
                           JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' ORDER BY u.id LIMIT 1`);
  if (!admin) throw new Error('لا يوجد حساب مدير. شغّل npm run seed أولًا.');

  const year = await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  const classes = await many('SELECT * FROM classes ORDER BY sort_order LIMIT 6');
  const sections = await many('SELECT * FROM sections');
  const feeTypes = Object.fromEntries((await many('SELECT id, code FROM fee_types')).map((t) => [t.code, t.id]));
  const methods = await many('SELECT * FROM payment_methods WHERE active ORDER BY sort_order');
  const settings = Object.fromEntries((await many('SELECT key, value FROM settings')).map((s) => [s.key, s.value]));

  const req = { user: admin, headers: { 'user-agent': 'seed-demo' }, ip: '127.0.0.1' };
  let created = 0; let payments = 0;

  for (let i = 0; i < 24; i++) {
    const cls = pick(classes, i);
    const sec = sections.filter((s) => s.class_id === cls.id)[i % 2] || null;
    const nationalId = `${PREFIX}${String(100000 + i)}`;
    const exists = await one('SELECT 1 FROM students WHERE national_id = $1', [nationalId]);
    if (exists) continue;

    const tuition = 1800 + (i % 5) * 200;
    // الزي مستقل عن حالة السداد حتى تظهر شاشة «الزي المدرسي» ببيانات واقعية
    const uniformRequired = i % 2 === 0;
    const discount = i % 7 === 0 ? 150 : 0;

    await tx(async (c) => {
      const { enrollment } = await createStudent(c, req, {
        national_id: nationalId,
        full_name: `${pick(FIRST, i)} ${pick(LAST, i)}`,
        guardian_name: null,
        guardian_phone: `09${String(12000000 + i * 137).slice(0, 8)}`,
        extra_phone: i % 4 === 0 ? `09${String(45000000 + i * 91).slice(0, 8)}` : null,
        notes: i % 6 === 0 ? 'طالب تجريبي' : null,
        year,
        class_id: cls.id,
        section_id: sec?.id || null,
        studentPrefix: settings.student_prefix || 'STU',
        fees: [
          { fee_type_id: feeTypes.tuition, amount: tuition.toFixed(2), discount: discount.toFixed(2), required: true },
          { fee_type_id: feeTypes.registration, amount: '150.00', discount: '0.00', required: true },
          { fee_type_id: feeTypes.uniform, amount: '120.00', discount: '0.00', required: uniformRequired },
          { fee_type_id: feeTypes.extra, amount: i % 5 === 0 ? '75.00' : '0.00', discount: '0.00', required: true }
        ]
      });
      created++;

      // ثلث الطلاب سدّدوا بالكامل، وثلث جزئيًا، وثلث لم يدفعوا بعد
      const mode = i % 3;
      if (mode !== 2) {
        const { rows: [balance] } = await c.query('SELECT * FROM enrollment_balances WHERE enrollment_id = $1', [enrollment.id]);
        const full = Number(balance.balance);
        const amount = mode === 0 ? full : Math.round(full * 0.4 * 100) / 100;
        if (amount > 0) {
          await recordPayment(c, req, {
            enrollmentId: enrollment.id,
            amount: amount.toFixed(2),
            methodId: pick(methods, i).id,
            notes: 'دفعة تجريبية',
            allocations: null,
            settings
          });
          payments++;
        }
      }
    });
  }

  const counts = await one(`
    SELECT (SELECT COUNT(*)::int FROM students WHERE national_id LIKE '${PREFIX}%') students,
           (SELECT COUNT(*)::int FROM payments) payments`);

  console.log(`\n  ✓ أُضيف ${created} طالبًا تجريبيًا و${payments} دفعة.`);
  console.log(`  إجمالي الطلاب التجريبيين الآن: ${counts.students}`);
  console.log('  لحذفها لاحقًا:  npm run seed:demo -- --clear\n');
}

run()
  .then(() => pool.end())
  .catch((err) => { console.error('\n✗ خطأ:', err.message); process.exit(1); });
