import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { config } from './config.js';
import { pool, ping } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed/seed.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { startBackupScheduler } from './services/backup.js';

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import studentsRoutes from './routes/students.js';
import feesRoutes from './routes/fees.js';
import financeRoutes from './routes/finance.js';
import paymentsRoutes from './routes/payments.js';
import receiptsRoutes from './routes/receipts.js';
import usersRoutes from './routes/users.js';
import excelRoutes from './routes/excel.js';
import reportsRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import auditRoutes from './routes/audit.js';
import backupRoutes from './routes/backup.js';

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

// ترويسات أمان أساسية (بلا اعتماد على مكتبة خارجية)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 600 }));

app.get('/api/health', async (_req, res) => {
  try {
    const now = await ping();
    res.json({ ok: true, service: 'shams-finance', version: config.appVersion, db_time: now });
  } catch (err) {
    res.status(503).json({ ok: false, message: 'قاعدة البيانات غير متاحة.', detail: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/backup', backupRoutes);

// الملفات المرفوعة (الشعار)
app.use('/uploads', express.static(config.paths.uploads, { maxAge: '1h' }));

// الواجهة المبنية — منفذ واحد فقط على الشبكة
if (fs.existsSync(config.paths.web)) {
  app.use(express.static(config.paths.web, { index: false }));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(config.paths.web, 'index.html')));
}

app.use(notFoundHandler);
app.use(errorHandler);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

export async function start() {
  await migrate({ quiet: true });
  if (process.env.SKIP_SEED !== '1') await seed({ quiet: true });

  const server = app.listen(config.port, config.host, () => {
    const addrs = lanAddresses();
    console.log('\n  المنظومة المالية — مدرسة شمس الوطن');
    console.log(`  الإصدار ${config.appVersion}`);
    console.log(`  على هذا الجهاز:      http://localhost:${config.port}`);
    for (const a of addrs) console.log(`  من أجهزة الشبكة:     http://${a}:${config.port}`);
    console.log('');
  });

  startBackupScheduler();

  const shutdown = async () => {
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('\n  ✗ تعذّر تشغيل النظام:', err.message);
    console.error('    تحقق من إعدادات قاعدة البيانات في ملف .env\n');
    process.exit(1);
  });
}

export default app;
