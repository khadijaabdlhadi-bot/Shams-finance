import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * كل ما يختلف من جهاز لآخر يأتي من متغيرات البيئة — لا مسار ثابت داخل الكود.
 */
const int = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),
  // 0.0.0.0 حتى تفتح بقية أجهزة الشبكة المحلية النظام
  host: process.env.HOST || '0.0.0.0',

  db: {
    url: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'shams',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shams_finance',
    max: int(process.env.DB_POOL_MAX, 10)
  },

  jwtSecret: process.env.JWT_SECRET || 'CHANGE-ME-IN-ENV',
  tokenHours: int(process.env.TOKEN_HOURS, 12),
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),

  login: {
    maxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 6),
    lockMinutes: int(process.env.LOGIN_LOCK_MINUTES, 10)
  },

  paths: {
    root: ROOT,
    data: dataDir,
    uploads: process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(dataDir, 'uploads'),
    backups: process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(dataDir, 'backups'),
    tmp: path.join(dataDir, 'tmp'),
    web: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.join(ROOT, 'web', 'dist')
  },

  backup: {
    auto: process.env.AUTO_BACKUP || 'daily',        // off | daily | weekly
    hour: int(process.env.AUTO_BACKUP_HOUR, 2),
    keep: int(process.env.BACKUP_KEEP, 14),
    pgBin: process.env.PG_BIN || ''                   // مجلد pg_dump إن لم يكن في PATH
  },

  chromium: process.env.CHROMIUM_PATH || '',
  timezone: process.env.TZ || 'Africa/Tripoli',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  schemaVersion: 1,
  appVersion: '1.0.0'
};

for (const dir of [config.paths.data, config.paths.uploads, config.paths.backups, config.paths.tmp]) {
  fs.mkdirSync(dir, { recursive: true });
}

export default config;
