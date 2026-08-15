import pg from 'pg';
import { config } from './config.js';

/**
 * NUMERIC يعود كنص من PostgreSQL — وهذا مقصود.
 * لا نحوّله إلى Number أبدًا حتى لا يدخل الخطأ العشري في الحسابات المالية.
 * التحويل الآمن يتم في lib/money.js إلى وحدات صغرى صحيحة.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool(
  config.db.url
    ? { connectionString: config.db.url, max: config.db.max }
    : {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        max: config.db.max
      }
);

pool.on('error', (err) => console.error('[db] خطأ في الاتصال:', err.message));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/**
 * معاملة واحدة. أي استثناء ⇒ ROLLBACK كامل.
 *   await tx(async (c) => { await c.query(...); })
 */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* الاتصال مقطوع أصلًا */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function ping() {
  const r = await pool.query('SELECT now() AS now');
  return r.rows[0].now;
}

export default { pool, query, one, many, tx, ping };
