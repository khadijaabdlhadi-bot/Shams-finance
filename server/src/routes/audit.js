import { Router } from 'express';
import { one, many } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { ACTION_LABELS } from '../lib/audit.js';
import v from '../lib/validate.js';

const r = Router();
r.use(requireAuth, requirePermission('audit.view'));

r.get('/actions', wrap(async (_req, res) => {
  res.json(Object.entries(ACTION_LABELS).map(([code, label]) => ({ code, label })));
}));

r.get('/', wrap(async (req, res) => {
  const { page, size, offset } = v.pagination(req.query);
  const params = [];
  const where = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (req.query.action) add('a.action = ?', String(req.query.action));
  if (req.query.user_id) add('a.user_id = ?', v.intId(req.query.user_id, 'المستخدم'));
  if (req.query.entity) add('a.entity = ?', String(req.query.entity));
  if (req.query.student_id) add('a.student_id = ?', v.intId(req.query.student_id, 'الطالب'));
  if (req.query.from) add('a.created_at >= ?::date', String(req.query.from).slice(0, 10));
  if (req.query.to) add("a.created_at < (?::date + interval '1 day')", String(req.query.to).slice(0, 10));
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(a.description ILIKE ${p} OR a.full_name ILIKE ${p} OR a.username ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT COUNT(*)::int AS c FROM audit_logs a ${whereSql}`, params)).c;

  params.push(size, offset);
  const rows = await many(
    `SELECT a.*, s.full_name AS student_name
     FROM audit_logs a LEFT JOIN students s ON s.id = a.student_id
     ${whereSql} ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    rows: rows.map((x) => ({ ...x, action_label: ACTION_LABELS[x.action] || x.action })),
    total, page, size, pages: Math.max(1, Math.ceil(total / size))
  });
}));

export default r;
