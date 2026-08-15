#!/usr/bin/env node
/**
 * نسخة احتياطية من سطر الأوامر — للجدولة الخارجية (Task Scheduler في ويندوز أو cron).
 *
 *   npm run backup                    إنشاء نسخة الآن
 *   npm run backup -- --list          عرض النسخ الموجودة
 *   npm run backup -- --verify        عرض عدّادات التحقق الحالية
 *   npm run backup -- --restore <ملف> استرجاع/نقل من ملف نسخة (للجهاز الجديد)
 *
 * مثال جدولة في ويندوز (يوميًا 2 فجرًا):
 *   schtasks /create /tn "Shams Backup" /tr "cmd /c cd /d C:\shams-finance && npm run backup" /sc daily /st 02:00
 */
import path from 'node:path';
import { pool, many } from '../db.js';
import { config } from '../config.js';
import { createBackup, verificationCounts, restoreBackup, inspectBackup } from '../services/backup.js';

const args = process.argv.slice(2);
const size = (b) => (!b ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.round(b / 1024)} ك.ب`);

try {
  if (args.includes('--list')) {
    const rows = await many(
      `SELECT b.filename, b.kind, b.size_bytes, b.status, b.created_at, u.full_name
       FROM backups b LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC LIMIT 30`
    );
    console.log(`\n  مجلد النسخ: ${config.paths.backups}\n`);
    if (!rows.length) console.log('  لا توجد نسخ بعد.');
    for (const r of rows) {
      console.log(`  ${r.created_at.toISOString().slice(0, 19).replace('T', ' ')}  ${size(r.size_bytes).padStart(10)}  ${r.kind.padEnd(11)} ${r.status === 'success' ? '✓' : '✗'}  ${r.filename}`);
    }
    console.log('');
  } else if (args.includes('--verify')) {
    const c = await verificationCounts();
    console.log('\n  الحالة الحالية لقاعدة البيانات:');
    console.log(`    الطلاب:        ${c.students}`);
    console.log(`    الدفعات:       ${c.payments}`);
    console.log(`    الإيصالات:     ${c.receipts}`);
    console.log(`    المستخدمون:    ${c.users}`);
    console.log(`    سجل العمليات:  ${c.audit_logs}`);
    console.log(`    إجمالي المحصّل: ${c.total_collected}\n`);
  } else if (args.includes('--restore')) {
    const file = path.resolve(args[args.indexOf('--restore') + 1] || '');
    if (!file) throw new Error('حدد مسار ملف النسخة: npm run backup -- --restore /path/backup.zip');
    const info = await inspectBackup(file);
    console.log(`\n  النسخة: ${path.basename(file)}`);
    console.log(`  تاريخها: ${info.manifest.created_at}`);
    console.log(`  محتواها: ${info.manifest.counts.students} طالبًا · ${info.manifest.counts.payments} دفعة`);
    console.log('  ⚠️  سيُستبدل كل ما في قاعدة البيانات الحالية. تُؤخذ نسخة أمان تلقائيًا أولًا.');
    const out = await restoreBackup(file, { user: { id: null, full_name: 'سطر الأوامر', username: 'cli' } });
    console.log(`\n  ${out.ok ? '✓ تم الاسترجاع واجتاز الفحص' : '⚠️ تم الاسترجاع لكن بعض الأعداد غير مطابقة'}`);
    for (const c of out.checks) console.log(`    ${c.ok ? '✓' : '✗'} ${c.key}: ${c.actual}${c.expected != null ? ` / ${c.expected}` : ''}`);
    console.log(`    نسخة الأمان قبل الاسترجاع: ${out.safety_backup}\n`);
  } else {
    const out = await createBackup({ kind: 'manual' });
    console.log(`\n  ✓ أُنشئت النسخة: ${out.filename}  (${size(out.size_bytes)})`);
    console.log(`    المسار: ${path.join(config.paths.backups, out.filename)}`);
    console.log(`    البصمة: ${out.sha256.slice(0, 16)}…`);
    console.log(`    المحتوى: ${out.counts.students} طالبًا · ${out.counts.payments} دفعة · ${out.counts.receipts} إيصالًا\n`);
  }
  await pool.end();
} catch (err) {
  console.error('\n  ✗ فشلت العملية:', err.message, '\n');
  process.exit(1);
}
