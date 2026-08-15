import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { config } from '../config.js';
import { pool, one, many, query } from '../db.js';
import { AppError } from '../lib/errors.js';

/**
 * النسخة الاحتياطية ملف .zip واحد:
 *   manifest.json   ← إصدار النظام والمخطط، التاريخ، من أخذها، عدّادات تحقق، SHA-256
 *   database.dump   ← pg_dump بصيغة custom
 *   uploads/        ← الشعار وأي مرفقات
 */

const bin = (name) => (config.backup.pgBin ? path.join(config.backup.pgBin, name) : name);

function dbEnv() {
  const env = { ...process.env };
  const c = config.db;
  if (c.url) {
    env.PGURL = c.url;
  } else {
    env.PGHOST = c.host; env.PGPORT = String(c.port);
    env.PGUSER = c.user; env.PGPASSWORD = c.password; env.PGDATABASE = c.database;
  }
  return env;
}

function run(cmd, args, { env, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err || `${cmd} انتهى بالرمز ${code}`))));
    if (input) { p.stdin.write(input); p.stdin.end(); }
  });
}

const target = () => (config.db.url ? [config.db.url] : []);

export async function verificationCounts() {
  const row = await one(`
    SELECT (SELECT COUNT(*) FROM students)::int    AS students,
           (SELECT COUNT(*) FROM payments)::int    AS payments,
           (SELECT COUNT(*) FROM receipts)::int    AS receipts,
           (SELECT COUNT(*) FROM users)::int       AS users,
           (SELECT COUNT(*) FROM audit_logs)::int  AS audit_logs,
           (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='active')::text AS total_collected
  `);
  return row;
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

/** إنشاء نسخة احتياطية. يُرجع بيانات الملف. */
export async function createBackup({ kind = 'manual', user = null } = {}) {
  fs.mkdirSync(config.paths.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `shams-backup-${stamp}-${kind}.zip`;
  const zipPath = path.join(config.paths.backups, name);
  const dumpPath = path.join(config.paths.tmp, `dump-${stamp}.dump`);

  const { rows: [inserted] } = await pool.query(
    `INSERT INTO backups (filename, kind, status, created_by) VALUES ($1,$2,'running',$3) RETURNING id`,
    [name, kind, user?.id || null]
  );

  try {
    const counts = await verificationCounts();

    // 1) تفريغ قاعدة البيانات بصيغة custom (مضغوطة وقابلة للاسترجاع الانتقائي)
    await run(bin('pg_dump'), [...target(), '--format=custom', '--file', dumpPath], { env: dbEnv() });

    // 2) تجميع كل شيء في ملف واحد
    const manifest = {
      app: 'shams-finance',
      app_version: config.appVersion,
      schema_version: config.schemaVersion,
      created_at: new Date().toISOString(),
      created_by: user ? { id: user.id, name: user.full_name, username: user.username } : { name: 'النظام (تلقائي)' },
      kind,
      database: config.db.database,
      counts
    };

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(zipPath);
      const zip = archiver('zip', { zlib: { level: 9 } });
      out.on('close', resolve);
      zip.on('error', reject);
      zip.pipe(out);
      zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      zip.file(dumpPath, { name: 'database.dump' });
      if (fs.existsSync(config.paths.uploads)) zip.directory(config.paths.uploads, 'uploads');
      zip.finalize();
    });

    const size = fs.statSync(zipPath).size;
    const hash = await sha256(zipPath);

    await pool.query(
      `UPDATE backups SET status='success', size_bytes=$1, sha256=$2, message=NULL WHERE id=$3`,
      [size, hash, inserted.id]
    );

    await pruneOld();
    return { id: inserted.id, filename: name, path: zipPath, size_bytes: size, sha256: hash, counts };
  } catch (err) {
    await pool.query(`UPDATE backups SET status='failed', message=$1 WHERE id=$2`, [err.message.slice(0, 500), inserted.id]);
    try { fs.existsSync(zipPath) && fs.unlinkSync(zipPath); } catch { /* ignore */ }
    throw new AppError(500, 'backup_failed', `تعذّر إنشاء النسخة الاحتياطية: ${err.message}`);
  } finally {
    try { fs.existsSync(dumpPath) && fs.unlinkSync(dumpPath); } catch { /* ignore */ }
  }
}

/** حذف النسخ الزائدة حتى لا يمتلئ القرص. */
export async function pruneOld() {
  const keep = Math.max(1, config.backup.keep);
  const rows = await many(
    `SELECT id, filename FROM backups WHERE status='success' AND kind IN ('auto','manual') ORDER BY created_at DESC OFFSET $1`,
    [keep]
  );
  for (const row of rows) {
    const file = path.join(config.paths.backups, row.filename);
    try { fs.existsSync(file) && fs.unlinkSync(file); } catch { /* ignore */ }
    await query('DELETE FROM backups WHERE id = $1', [row.id]);
  }
  return rows.length;
}

/** قراءة المانيفست من ملف نسخة والتحقق منه — قبل أي استرجاع. */
export async function inspectBackup(zipPath) {
  if (!fs.existsSync(zipPath)) throw new AppError(404, 'not_found', 'ملف النسخة الاحتياطية غير موجود.');
  let manifest = null;
  let hasDump = false;

  const dir = await unzipper.Open.file(zipPath).catch(() => null);
  if (!dir) throw new AppError(400, 'bad_backup', 'الملف ليس نسخة احتياطية صالحة (ليس ملف zip).');

  for (const entry of dir.files) {
    if (entry.path === 'manifest.json') {
      const buf = await entry.buffer();
      try { manifest = JSON.parse(buf.toString('utf8')); }
      catch { throw new AppError(400, 'bad_backup', 'ملف الوصف داخل النسخة تالف.'); }
    }
    if (entry.path === 'database.dump') hasDump = true;
  }

  if (!manifest) throw new AppError(400, 'bad_backup', 'النسخة لا تحتوي على ملف الوصف manifest.json.');
  if (!hasDump) throw new AppError(400, 'bad_backup', 'النسخة لا تحتوي على قاعدة البيانات.');
  if (manifest.app !== 'shams-finance') throw new AppError(400, 'bad_backup', 'هذه النسخة تخص نظامًا آخر.');
  if (Number(manifest.schema_version) > config.schemaVersion) {
    throw new AppError(400, 'version_mismatch',
      `النسخة أُخذت من إصدار أحدث من النظام (${manifest.app_version}). حدّث النظام أولًا ثم أعد الاسترجاع.`);
  }

  return { manifest, sha256: await sha256(zipPath), size: fs.statSync(zipPath).size };
}

/**
 * الاسترجاع — خطوات آمنة:
 * 1) فحص الملف والمانيفست   2) نسخة احتياطية تلقائية للحالة الحالية
 * 3) pg_restore --clean      4) فحص ما بعد الاسترجاع
 */
export async function restoreBackup(zipPath, { user, req } = {}) {
  const info = await inspectBackup(zipPath);
  const before = await verificationCounts();

  // 2) لا نلمس البيانات قبل حفظ الحالة الحالية
  const safety = await createBackup({ kind: 'pre_restore', user });

  const workDir = path.join(config.paths.tmp, `restore-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: workDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    const dump = path.join(workDir, 'database.dump');
    if (!fs.existsSync(dump)) throw new AppError(400, 'bad_backup', 'قاعدة البيانات مفقودة داخل النسخة.');

    // نغلق مجمع الاتصالات حتى لا تمنع الجلسات المفتوحة عملية DROP
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`
    ).catch(() => {});

    await run(bin('pg_restore'), [
      ...(config.db.url ? ['--dbname', config.db.url] : ['--dbname', config.db.database]),
      '--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', dump
    ], { env: dbEnv() });

    // استرجاع المرفقات
    const uploads = path.join(workDir, 'uploads');
    if (fs.existsSync(uploads)) {
      fs.mkdirSync(config.paths.uploads, { recursive: true });
      for (const f of fs.readdirSync(uploads)) {
        fs.copyFileSync(path.join(uploads, f), path.join(config.paths.uploads, f));
      }
    }

    // 4) فحص ما بعد الاسترجاع
    const after = await verificationCounts();
    const expected = info.manifest.counts || {};
    // ملاحظة: سجل العمليات يزيد بسطر واحد لأن عملية الاسترجاع نفسها تُسجَّل بعد التنفيذ،
    // لذلك الشرط عليه «لا يقل عن» بدل «يساوي».
    const checks = ['students', 'payments', 'receipts', 'users', 'audit_logs'].map((key) => ({
      key,
      expected: expected[key] ?? null,
      actual: after[key],
      ok: expected[key] === undefined || expected[key] === null
        || (key === 'audit_logs'
          ? Number(after[key]) >= Number(expected[key])
          : Number(expected[key]) === Number(after[key]))
    }));
    const balanceOk = expected.total_collected === undefined
      || Number(expected.total_collected) === Number(after.total_collected);

    const result = {
      ok: checks.every((c) => c.ok) && balanceOk,
      manifest: info.manifest,
      before, after, checks,
      balance_check: { expected: expected.total_collected ?? null, actual: after.total_collected, ok: balanceOk },
      safety_backup: safety.filename
    };

    // سجل خارج قاعدة البيانات — لأن أي سجل داخلها سيُستبدل بمحتوى النسخة
    logRestore({
      at: new Date().toISOString(),
      by: user ? `${user.full_name} (${user.username})` : 'غير معروف',
      file: path.basename(zipPath),
      backup_created_at: info.manifest.created_at,
      safety_backup: safety.filename,
      result: result.ok ? 'success' : 'verification_warning',
      after
    });

    // ونكتبه أيضًا داخل السجل الجديد ليظهر في الواجهة
    await query(
      `INSERT INTO audit_logs (user_id, username, full_name, action, entity, description, new_values, ip_address)
       VALUES ($1,$2,$3,'restore','backup',$4,$5,$6)`,
      [user?.id || null, user?.username || null, user?.full_name || null,
        `استرجاع نسخة احتياطية (${path.basename(zipPath)}) — نسخة أمان: ${safety.filename}`,
        JSON.stringify(result.checks), req?.ip || null]
    ).catch(() => {});

    return result;
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function logRestore(entry) {
  const file = path.join(config.paths.data, 'restore.log');
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readRestoreLog() {
  const file = path.join(config.paths.data, 'restore.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).reverse().slice(0, 50);
}

/* ---------------- الجدولة التلقائية ---------------- */

let timer = null;

export function startBackupScheduler() {
  if (config.backup.auto === 'off') return null;
  if (timer) clearInterval(timer);

  let lastRun = null;
  timer = setInterval(async () => {
    const now = new Date();
    const key = now.toISOString().slice(0, 10);
    if (now.getHours() !== config.backup.hour || lastRun === key) return;
    if (config.backup.auto === 'weekly' && now.getDay() !== 5) return;   // الجمعة
    lastRun = key;
    try {
      const out = await createBackup({ kind: 'auto' });
      console.log(`[backup] نسخة تلقائية: ${out.filename}`);
    } catch (err) {
      console.error('[backup] فشلت النسخة التلقائية:', err.message);
    }
  }, 10 * 60 * 1000);

  timer.unref?.();
  return timer;
}

export default {
  createBackup, restoreBackup, inspectBackup, pruneOld,
  verificationCounts, startBackupScheduler, readRestoreLog
};
