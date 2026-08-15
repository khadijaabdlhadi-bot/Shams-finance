#!/usr/bin/env node
/**
 * إنشاء حساب مدير — يُستخدم عند أول تثبيت أو إذا فُقدت كلمة مرور المدير.
 *   node src/scripts/create-admin.js --username admin --password "كلمة المرور" --name "الاسم"
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pool, one } from '../db.js';
import { migrate } from '../migrate.js';
import { seed } from '../seed/seed.js';
import { hashPassword } from '../middleware/auth.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, [])
);

async function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  if (hidden) stdout.write(question);
  const answer = hidden ? await rl.question('') : await rl.question(question);
  rl.close();
  return answer.trim();
}

try {
  await migrate({ quiet: true });
  await seed({ quiet: true });

  const username = args.username || await ask('اسم المستخدم: ');
  const fullName = args.name || await ask('الاسم الكامل: ');
  const password = args.password || await ask('كلمة المرور (8 أحرف على الأقل): ', true);

  if (!username || !password || password.length < 8) {
    console.error('\n✗ اسم المستخدم مطلوب وكلمة المرور 8 أحرف على الأقل.');
    process.exit(1);
  }

  const role = await one("SELECT id FROM roles WHERE code = 'admin'");
  const existing = await one('SELECT id FROM users WHERE username_lower = lower($1)', [username]);

  if (existing) {
    await pool.query(
      `UPDATE users SET password_hash = $1, role_id = $2, active = TRUE, full_name = COALESCE($3, full_name),
              failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $4`,
      [hashPassword(password), role.id, fullName || null, existing.id]
    );
    console.log(`\n✓ تم تحديث الحساب «${username}» وتعيينه مديرًا مع كلمة المرور الجديدة.`);
  } else {
    await pool.query(
      `INSERT INTO users (full_name, username, password_hash, role_id) VALUES ($1,$2,$3,$4)`,
      [fullName || username, username, hashPassword(password), role.id]
    );
    console.log(`\n✓ أُنشئ حساب المدير «${username}».`);
  }
  await pool.end();
} catch (err) {
  console.error('\n✗ خطأ:', err.message);
  process.exit(1);
}
