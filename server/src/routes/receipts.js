import { Router } from 'express';
import { one, many, query, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { notFound, AppError } from '../lib/errors.js';
import v from '../lib/validate.js';
import { renderReceiptHtml } from '../services/receipt-html.js';
import { logoDataUri } from '../services/logo.js';
import { htmlToPdf, pdfAvailable } from '../services/pdf.js';

const r = Router();
r.use(requireAuth);

const loadReceipt = async (id) => {
  const row = await one(
    `SELECT rc.*, p.status AS payment_status, p.void_reason, s.full_name, s.id AS student_id
     FROM receipts rc JOIN payments p ON p.id = rc.payment_id
     JOIN students s ON s.id = p.student_id WHERE rc.id = $1`,
    [id]
  );
  if (!row) throw notFound('الإيصال غير موجود.');
  return row;
};

/* ---------------- قائمة الإيصالات ---------------- */

r.get('/', requirePermission('payments.view'), wrap(async (req, res) => {
  const { page, size, offset } = v.pagination(req.query);
  const params = [];
  const where = [];
  if (req.query.status && req.query.status !== 'all') { params.push(req.query.status); where.push(`rc.status = $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from).slice(0, 10)); where.push(`rc.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(String(req.query.to).slice(0, 10)); where.push(`rc.created_at < ($${params.length}::date + interval '1 day')`); }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(rc.receipt_number ILIKE ${p} OR s.full_name ILIKE ${p} OR s.national_id LIKE ${p})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM receipts rc JOIN payments p ON p.id = rc.payment_id
                JOIN students s ON s.id = p.student_id JOIN users u ON u.id = rc.created_by ${whereSql}`;
  const total = (await one(`SELECT COUNT(*)::int AS c ${base}`, params)).c;
  params.push(size, offset);
  const rows = await many(
    `SELECT rc.id, rc.receipt_number, rc.status, rc.created_at, rc.print_count,
            p.amount, p.id AS payment_id, s.full_name, s.national_id, s.id AS student_id, u.full_name AS cashier
     ${base} ORDER BY rc.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)) });
}));

r.get('/:id', requirePermission('payments.view'), wrap(async (req, res) => {
  const row = await loadReceipt(v.intId(req.params.id, 'الإيصال'));
  res.json(row);
}));

/* ---------------- عرض / طباعة ---------------- */

/** صفحة HTML جاهزة للطباعة (وهي نفسها مصدر PDF) */
r.get('/:id/print', requirePermission('receipts.print'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الإيصال');
  const receipt = await loadReceipt(id);
  const reprint = receipt.print_count > 0;

  await tx(async (c) => {
    await c.query('UPDATE receipts SET print_count = print_count + 1 WHERE id = $1', [id]);
    await audit(c, req, {
      action: reprint ? ACTIONS.RECEIPT_REPRINT : ACTIONS.RECEIPT_ISSUE,
      entity: 'receipt', entityId: id, studentId: receipt.student_id,
      description: `${reprint ? 'إعادة طباعة' : 'طباعة'} الإيصال ${receipt.receipt_number}`
    });
  });

  const html = renderReceiptHtml(receipt, {
    copies: Math.min(3, Number(req.query.copies) || 1),
    reprint,
    timezone: config.timezone,
    logo: await logoDataUri()
  });
  res.type('html').send(html);
}));

/** معاينة بدون تسجيل طباعة */
r.get('/:id/preview', requirePermission('payments.view'), wrap(async (req, res) => {
  const receipt = await loadReceipt(v.intId(req.params.id, 'الإيصال'));
  res.type('html').send(renderReceiptHtml(receipt, {
    reprint: receipt.print_count > 0, timezone: config.timezone, logo: await logoDataUri()
  }));
}));

/** تنزيل PDF */
r.get('/:id/pdf', requirePermission('receipts.print'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الإيصال');
  const receipt = await loadReceipt(id);

  if (!(await pdfAvailable())) {
    throw new AppError(501, 'pdf_unavailable',
      'تنزيل PDF غير متاح على هذا الخادم. استخدم زر الطباعة ثم اختر «حفظ كـ PDF» من نافذة الطباعة.');
  }

  const html = renderReceiptHtml(receipt, {
    reprint: receipt.print_count > 0, timezone: config.timezone, logo: await logoDataUri()
  });
  const pdf = await htmlToPdf(html);

  await tx(async (c) => {
    await c.query('UPDATE receipts SET print_count = print_count + 1 WHERE id = $1', [id]);
    await audit(c, req, {
      action: receipt.print_count > 0 ? ACTIONS.RECEIPT_REPRINT : ACTIONS.RECEIPT_ISSUE,
      entity: 'receipt', entityId: id, studentId: receipt.student_id,
      description: `تنزيل PDF للإيصال ${receipt.receipt_number}`
    });
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${receipt.receipt_number}.pdf"`);
  res.send(pdf);
}));

r.get('/status/pdf', wrap(async (_req, res) => res.json({ available: await pdfAvailable() })));

export default r;
