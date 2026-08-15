import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { one } from '../db.js';

/**
 * شعار المدرسة كـ data URI — تحتاجه صفحات الطباعة و PDF لأنها قد تُفتح
 * من blob أو من Chromium بلا خادم، فلا تُحل المسارات النسبية.
 * يُقرأ مرة واحدة ويُخزَّن في الذاكرة، ويتحدث إذا تغيّر الملف.
 */
let cache = { key: null, uri: null };

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

export async function logoDataUri() {
  let logoPath = '';
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'logo_path'");
    logoPath = row?.value || '';
  } catch { /* القاعدة غير متاحة */ }
  if (!logoPath) return null;
  if (logoPath.startsWith('data:')) return logoPath;

  const name = path.basename(logoPath);
  const candidates = [
    path.join(config.paths.uploads, name),
    path.join(config.paths.web, name),
    path.join(config.paths.root, 'web', 'public', name)
  ];

  for (const file of candidates) {
    try {
      const stat = await fs.stat(file);
      const key = `${file}:${stat.mtimeMs}:${stat.size}`;
      if (cache.key === key) return cache.uri;
      const buf = await fs.readFile(file);
      const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
      cache = { key, uri: `data:${mime};base64,${buf.toString('base64')}` };
      return cache.uri;
    } catch { /* جرّب المسار التالي */ }
  }
  return null;
}

export default logoDataUri;
