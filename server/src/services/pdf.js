import fs from 'node:fs';
import { config } from '../config.js';

/**
 * تحويل HTML إلى PDF عبر Chromium بلا واجهة.
 * السبب: العربية RTL تُرسم بشكل صحيح لأن الذي يرسمها محرك المتصفح نفسه،
 * لا مكتبة PDF تحتاج تشكيل الحروف العربية يدويًا.
 *
 * إذا لم يوجد Chromium على الجهاز، يبقى زر «طباعة» يعمل (المتصفح يحفظ PDF بنفسه).
 */
const CANDIDATES = [
  config.chromium,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium'
].filter(Boolean);

let cached;

export function chromiumPath() {
  if (cached !== undefined) return cached;
  cached = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
  return cached;
}

export async function pdfAvailable() {
  if (!chromiumPath()) return false;
  try { await import('puppeteer-core'); return true; } catch { return false; }
}

export async function htmlToPdf(html) {
  const exe = chromiumPath();
  if (!exe) throw new Error('Chromium غير مثبت على هذا الخادم.');
  const puppeteer = (await import('puppeteer-core')).default;

  const browser = await puppeteer.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } });
  } finally {
    await browser.close();
  }
}

export default { htmlToPdf, pdfAvailable, chromiumPath };
