import { Router } from 'express';
import { one, many, query, tx } from '../db.js';
import { requireAuth, requirePermission, can } from '../middleware/auth.js';
import { wrap } from '../middleware/errorHandler.js';
import { audit, diff, ACTIONS } from '../lib/audit.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import v from '../lib/validate.js';
import { getSettings } from './settings.js';
import {
  createStudent, listStudents, statusCounts, studentProfile, resolveYear, saveFees
} from '../services/students.js';

const r = Router();
r.use(requireAuth);

const currentYear = async (yearId) => {
  const row = yearId
    ? await one('SELECT * FROM academic_years WHERE id = $1', [yearId])
    : await one('SELECT * FROM academic_years WHERE is_current LIMIT 1');
  if (!row) throw badRequest('لا توجد سنة دراسية محددة. اضبطها من الإعدادات.');
  return row;
};

/* ---------------- القائمة والبحث ---------------- */

r.get('/', requirePermission('students.view'), wrap(async (req, res) => {
  const year = await currentYear(v.intId(req.query.year_id, 'السنة', { required: false }));
  const { page, size, offset } = v.pagination(req.query);
  const out = await listStudents({
    yearId: year.id,
    search: v.optString(req.query.q, { max: 80 }),
    status: req.query.status || 'active',
    paymentStatus: req.query.payment_status || 'all',
    classId: v.intId(req.query.class_id, 'الصف', { required: false }),
    sectionId: v.intId(req.query.section_id, 'الفصل', { required: false }),
    page, size, offset
  });
  res.json({ ...out, year });
}));

r.get('/counts', requirePermission('students.view'), wrap(async (req, res) => {
  const year = await currentYear(v.intId(req.query.year_id, 'السنة', { required: false }));
  res.json(await statusCounts(year.id));
}));

/* ---------------- إنشاء طالب ---------------- */

r.post('/', requirePermission('students.create'), wrap(async (req, res) => {
  const b = req.body || {};
  const settings = await getSettings();
  const year = await currentYear(v.intId(b.academic_year_id, 'السنة', { required: false }));

  const data = {
    national_id: v.nationalId(b.national_id),
    full_name: v.reqString(b.full_name, 'اسم الطالب', { max: 160 }),
    guardian_name: v.optString(b.guardian_name, { max: 160 }),
    guardian_phone: v.phone(b.guardian_phone, { label: 'هاتف ولي الأمر' }),
    extra_phone: v.phone(b.extra_phone, { label: 'الهاتف الإضافي' }),
    notes: v.optString(b.notes, { max: 1000 }),
    class_id: v.intId(b.class_id, 'الصف', { required: false }),
    section_id: v.intId(b.section_id, 'الفصل', { required: false }),
    year,
    studentPrefix: settings.student_prefix || 'STU',
    fees: await buildFees(b)
  };

  // فحص مبكر لرسالة أوضح (القيد في القاعدة هو الحماية الحقيقية ضد التزامن)
  const existing = await one('SELECT full_name, student_number FROM students WHERE national_id = $1', [data.national_id]);
  if (existing) throw conflict(`هذا الرقم الوطني مسجل مسبقًا للطالب: ${existing.full_name} (${existing.student_number})`);

  const out = await tx(async (c) => {
    const created = await createStudent(c, req, data);
    await audit(c, req, {
      action: ACTIONS.STUDENT_CREATE, entity: 'student', entityId: created.student.id,
      studentId: created.student.id,
      description: `إضافة الطالب ${data.full_name} (${created.student.student_number})`,
      newValues: {
        national_id: data.national_id, full_name: data.full_name,
        class_id: data.class_id, section_id: data.section_id, year: year.name
      }
    });
    return created;
  });

  res.status(201).json(await studentProfile(out.student.id, year.id));
}));

async function buildFees(b) {
  const types = await many('SELECT * FROM fee_types WHERE active ORDER BY sort_order');
  const byCode = Object.fromEntries(types.map((t) => [t.code, t]));
  const fees = [];
  const push = (code, amount, { required = true, discount = '0.00' } = {}) => {
    const t = byCode[code];
    if (!t) return;
    fees.push({ fee_type_id: t.id, amount, discount, required });
  };

  push('tuition', v.amount(b.tuition_fee ?? b.tuition ?? 0, 'الرسوم الدراسية'));
  push('registration', v.amount(b.registration_fee ?? 0, 'رسوم التسجيل'));
  const uniformRequired = v.bool(b.uniform_required, false);
  push('uniform', v.amount(b.uniform_fee ?? 0, 'رسوم الزي'), { required: uniformRequired });
  push('extra', v.amount(b.extra_fee ?? 0, 'الرسوم الإضافية'));

  // الخصم يُطبّق على الرسوم الدراسية افتراضيًا
  const discount = v.amount(b.discount ?? 0, 'الخصم');
  if (Number(discount) > 0) {
    const tuition = fees.find((f) => f.fee_type_id === byCode.tuition?.id);
    if (!tuition) throw badRequest('لا يمكن تطبيق خصم بدون رسوم دراسية.');
    if (Number(discount) > Number(tuition.amount)) throw badRequest('الخصم أكبر من الرسوم الدراسية.');
    tuition.discount = discount;
  }
  return fees;
}

/* ---------------- ملف الطالب ---------------- */

r.get('/:id', requirePermission('students.view'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const yearId = v.intId(req.query.year_id, 'السنة', { required: false });
  res.json(await studentProfile(id, yearId));
}));

/** سجل نشاط الطالب */
r.get('/:id/timeline', requirePermission('students.view'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const rows = await many(
    `SELECT id, action, description, full_name AS user_name, created_at, old_values, new_values
     FROM audit_logs WHERE student_id = $1 ORDER BY id DESC LIMIT 200`,
    [id]
  );
  res.json(rows);
}));

/* ---------------- التعديل ---------------- */

r.patch('/:id', requirePermission('students.update'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const b = req.body || {};
  const before = await one('SELECT * FROM students WHERE id = $1', [id]);
  if (!before) throw notFound('الطالب غير موجود.');

  const patch = {};
  if (b.full_name !== undefined) patch.full_name = v.reqString(b.full_name, 'اسم الطالب', { max: 160 });
  if (b.guardian_name !== undefined) patch.guardian_name = v.optString(b.guardian_name, { max: 160 });
  if (b.guardian_phone !== undefined) patch.guardian_phone = v.phone(b.guardian_phone, { label: 'هاتف ولي الأمر' });
  if (b.extra_phone !== undefined) patch.extra_phone = v.phone(b.extra_phone, { label: 'الهاتف الإضافي' });
  if (b.notes !== undefined) patch.notes = v.optString(b.notes, { max: 1000 });

  // تغيير الرقم الوطني يحتاج صلاحية خاصة ويُسجَّل كحدث مستقل
  let nationalChanged = null;
  if (b.national_id !== undefined) {
    const next = v.nationalId(b.national_id);
    if (next !== before.national_id) {
      if (!can(req.user, 'students.change_national_id')) {
        throw forbidden('تغيير الرقم الوطني يحتاج صلاحية خاصة. راجع مدير النظام.');
      }
      const clash = await one('SELECT full_name, student_number FROM students WHERE national_id = $1 AND id <> $2', [next, id]);
      if (clash) throw conflict(`هذا الرقم الوطني مسجل مسبقًا للطالب: ${clash.full_name} (${clash.student_number})`);
      patch.national_id = next;
      nationalChanged = { from: before.national_id, to: next, reason: v.optString(b.reason, { max: 300 }) };
    }
  }

  if (!Object.keys(patch).length) return res.json(await studentProfile(id));

  await tx(async (c) => {
    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`);
    const values = Object.values(patch);
    values.push(req.user.id, id);
    await c.query(
      `UPDATE students SET ${sets.join(', ')}, updated_by = $${values.length - 1}, updated_at = now()
       WHERE id = $${values.length}`,
      values
    );

    const d = diff(before, { ...before, ...patch }, Object.keys(patch));
    await audit(c, req, {
      action: ACTIONS.STUDENT_UPDATE, entity: 'student', entityId: id, studentId: id,
      description: `تعديل بيانات الطالب ${before.full_name}`,
      ...(d || {})
    });

    if (nationalChanged) {
      await audit(c, req, {
        action: ACTIONS.STUDENT_NATIONAL_ID_CHANGE, entity: 'student', entityId: id, studentId: id,
        description: `تغيير الرقم الوطني من ${nationalChanged.from} إلى ${nationalChanged.to}`
          + (nationalChanged.reason ? ` — السبب: ${nationalChanged.reason}` : ''),
        oldValues: { national_id: nationalChanged.from },
        newValues: { national_id: nationalChanged.to, reason: nationalChanged.reason }
      });
    }
  });

  res.json(await studentProfile(id));
}));

/** تعديل بيانات التسجيل (الصف/الفصل) */
r.patch('/:id/enrollment', requirePermission('students.update'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const year = await currentYear(v.intId(req.body?.academic_year_id, 'السنة', { required: false }));
  const before = await one('SELECT * FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2', [id, year.id]);
  if (!before) throw notFound('الطالب غير مسجل في هذه السنة الدراسية.');

  const classId = v.intId(req.body?.class_id, 'الصف', { required: false });
  const sectionId = v.intId(req.body?.section_id, 'الفصل', { required: false });

  await tx(async (c) => {
    await c.query(
      `UPDATE student_enrollments SET class_id = $1, section_id = $2, updated_by = $3, updated_at = now() WHERE id = $4`,
      [classId, sectionId, req.user.id, before.id]
    );
    await audit(c, req, {
      action: ACTIONS.ENROLLMENT_UPDATE, entity: 'enrollment', entityId: before.id, studentId: id,
      description: 'تعديل الصف/الفصل',
      oldValues: { class_id: before.class_id, section_id: before.section_id },
      newValues: { class_id: classId, section_id: sectionId }
    });
  });
  res.json(await studentProfile(id, year.id));
}));

/* ---------------- الرسوم والخصومات ---------------- */

r.put('/:id/fees', requirePermission('fees.update'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const year = await currentYear(v.intId(req.body?.academic_year_id, 'السنة', { required: false }));
  const enrollment = await one('SELECT * FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2', [id, year.id]);
  if (!enrollment) throw notFound('الطالب غير مسجل في هذه السنة الدراسية.');

  const items = Array.isArray(req.body?.fees) ? req.body.fees : [];
  if (!items.length) throw badRequest('لا توجد رسوم للحفظ.');

  const paid = await one('SELECT total_paid FROM enrollment_balances WHERE enrollment_id = $1', [enrollment.id]);
  const hasPayments = Number(paid?.total_paid || 0) > 0;
  const reason = v.optString(req.body?.reason, { max: 300 });
  if (hasPayments && !reason) {
    throw badRequest('للطالب دفعات مسجلة — يجب كتابة سبب تعديل الرسوم.');
  }

  const before = await many(
    `SELECT f.*, t.name_ar AS fee_name FROM student_fees f JOIN fee_types t ON t.id = f.fee_type_id
     WHERE f.enrollment_id = $1`, [enrollment.id]
  );
  const beforeById = Object.fromEntries(before.map((f) => [f.fee_type_id, f]));

  const prepared = items.map((f) => {
    const feeTypeId = v.intId(f.fee_type_id, 'نوع الرسوم');
    const amount = v.amount(f.amount, 'قيمة الرسوم');
    const discount = v.amount(f.discount ?? 0, 'الخصم');
    if (Number(discount) > Number(amount)) throw badRequest('الخصم لا يمكن أن يتجاوز قيمة الرسم.');
    if (Number(discount) > 0 && !can(req.user, 'fees.discount')) {
      throw forbidden('منح الخصم يحتاج صلاحية خاصة.');
    }
    return { fee_type_id: feeTypeId, amount, discount, required: f.required !== false, notes: v.optString(f.notes) };
  });

  // لا نسمح بجعل المستحق أقل من المدفوع فعلًا
  const newDue = prepared.reduce((s, f) => (f.required ? s + Math.round((Number(f.amount) - Number(f.discount)) * 100) : s), 0);
  if (newDue < Math.round(Number(paid?.total_paid || 0) * 100)) {
    throw badRequest('إجمالي المستحق الجديد أقل من المبلغ المدفوع فعليًا. ألغِ الدفعات الزائدة أولًا.');
  }

  await tx(async (c) => {
    await saveFees(c, req, enrollment.id, prepared);

    for (const f of prepared) {
      const old = beforeById[f.fee_type_id];
      const changedAmount = !old || String(old.amount) !== String(f.amount);
      const changedDiscount = !old || String(old.discount) !== String(f.discount);
      if (!changedAmount && !changedDiscount) continue;

      if (old) {
        await c.query(
          `INSERT INTO fee_changes (student_fee_id, old_amount, new_amount, old_discount, new_discount, reason, changed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [old.id, old.amount, f.amount, old.discount, f.discount, reason || 'تعديل الرسوم', req.user.id]
        );
      }
      if (changedDiscount && Number(f.discount) > 0) {
        await c.query(
          `UPDATE student_fees SET discount_reason = $1, discount_by = $2, discount_at = now()
           WHERE enrollment_id = $3 AND fee_type_id = $4`,
          [reason || 'خصم', req.user.id, enrollment.id, f.fee_type_id]
        );
        await audit(c, req, {
          action: ACTIONS.DISCOUNT_GRANT, entity: 'student_fee', entityId: old?.id ?? null, studentId: id,
          description: `منح خصم ${f.discount} على ${old?.fee_name || 'رسوم'}${reason ? ` — ${reason}` : ''}`,
          oldValues: { discount: old?.discount ?? '0.00' }, newValues: { discount: f.discount, reason }
        });
      }
    }

    await audit(c, req, {
      action: ACTIONS.FEE_UPDATE, entity: 'enrollment', entityId: enrollment.id, studentId: id,
      description: `تعديل الرسوم${reason ? ` — السبب: ${reason}` : ''}`,
      oldValues: Object.fromEntries(before.map((f) => [f.fee_name, `${f.amount} (خصم ${f.discount})`])),
      newValues: Object.fromEntries(prepared.map((f) => [beforeById[f.fee_type_id]?.fee_name || f.fee_type_id, `${f.amount} (خصم ${f.discount})`]))
    });
  });

  res.json(await studentProfile(id, year.id));
}));

/* ---------------- الأرشفة ---------------- */

r.post('/:id/archive', requirePermission('students.archive'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const reason = v.optString(req.body?.reason, { max: 300 });
  const student = await one('SELECT * FROM students WHERE id = $1', [id]);
  if (!student) throw notFound('الطالب غير موجود.');
  if (student.status === 'archived') throw badRequest('الطالب مؤرشف بالفعل.');

  await tx(async (c) => {
    await c.query(
      `UPDATE students SET status = 'archived', archived_at = now(), archived_by = $1, archive_reason = $2,
                           updated_by = $1, updated_at = now() WHERE id = $3`,
      [req.user.id, reason, id]
    );
    await audit(c, req, {
      action: ACTIONS.STUDENT_ARCHIVE, entity: 'student', entityId: id, studentId: id,
      description: `أرشفة الطالب ${student.full_name}${reason ? ` — ${reason}` : ''}`,
      oldValues: { status: student.status }, newValues: { status: 'archived', reason }
    });
  });
  res.json({ ok: true, message: 'تمت أرشفة الطالب. بياناته وتاريخه المالي محفوظان.' });
}));

r.post('/:id/restore', requirePermission('students.archive'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const student = await one('SELECT * FROM students WHERE id = $1', [id]);
  if (!student) throw notFound('الطالب غير موجود.');
  await tx(async (c) => {
    await c.query(
      `UPDATE students SET status = 'active', archived_at = NULL, archived_by = NULL, archive_reason = NULL,
                           updated_by = $1, updated_at = now() WHERE id = $2`,
      [req.user.id, id]
    );
    await audit(c, req, {
      action: ACTIONS.STUDENT_RESTORE, entity: 'student', entityId: id, studentId: id,
      description: `إلغاء أرشفة الطالب ${student.full_name}`
    });
  });
  res.json({ ok: true });
}));

/* ---------------- الأقساط ---------------- */

r.post('/:id/installments', requirePermission('installments.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const year = await currentYear(v.intId(req.body?.academic_year_id, 'السنة', { required: false }));
  const enrollment = await one('SELECT * FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2', [id, year.id]);
  if (!enrollment) throw notFound('الطالب غير مسجل في هذه السنة.');

  const name = v.reqString(req.body?.name_ar, 'اسم القسط', { max: 80 });
  const amount = v.amount(req.body?.amount, 'قيمة القسط', { allowZero: false });
  const due = req.body?.due_date ? String(req.body.due_date).slice(0, 10) : null;
  const notes = v.optString(req.body?.notes, { max: 500 });

  const row = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO installments (enrollment_id, name_ar, amount, due_date, notes, sort_order, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT MAX(sort_order)+1 FROM installments WHERE enrollment_id=$1),1), $6,$6)
       RETURNING *`,
      [enrollment.id, name, amount, due, notes, req.user.id]
    );
    await audit(c, req, {
      action: ACTIONS.INSTALLMENT_CREATE, entity: 'installment', entityId: rows[0].id, studentId: id,
      description: `إضافة قسط ${name} بقيمة ${amount}`
    });
    return rows[0];
  });
  res.status(201).json(row);
}));

/** تعديل قسط — مع حماية: لا تُخفَّض قيمته تحت ما دُفع عليه فعلًا. */
r.patch('/:id/installments/:instId', requirePermission('installments.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const instId = v.intId(req.params.instId, 'القسط');

  const before = await one(
    `SELECT i.*, ip.paid FROM installments i
     JOIN installment_paid ip ON ip.installment_id = i.id
     JOIN student_enrollments e ON e.id = i.enrollment_id
     WHERE i.id = $1 AND e.student_id = $2`,
    [instId, id]
  );
  if (!before) throw notFound('القسط غير موجود.');

  const b = req.body || {};
  const name = b.name_ar !== undefined ? v.reqString(b.name_ar, 'اسم القسط', { max: 80 }) : before.name_ar;
  const amount = b.amount !== undefined ? v.amount(b.amount, 'قيمة القسط', { allowZero: false }) : String(before.amount);
  const due = b.due_date !== undefined ? (b.due_date ? String(b.due_date).slice(0, 10) : null) : before.due_date;
  const notes = b.notes !== undefined ? v.optString(b.notes, { max: 500 }) : before.notes;
  const reason = v.optString(b.reason, { max: 300 });

  // القاعدة المالية: القيمة الجديدة لا تقل عن المدفوع فعلًا على هذا القسط
  const paidMinor = Math.round(Number(before.paid) * 100);
  const newMinor = Math.round(Number(amount) * 100);
  if (newMinor < paidMinor) {
    throw badRequest(
      `لا يمكن جعل قيمة القسط أقل من المبلغ المدفوع عليه (${Number(before.paid).toFixed(2)}).`
      + ' ألغِ الدفعات الزائدة أولًا إن كانت خاطئة.'
    );
  }

  const changed = String(before.name_ar) !== name
    || String(before.amount) !== String(Number(amount).toFixed(2))
    || String(before.due_date || '') !== String(due || '')
    || String(before.notes || '') !== String(notes || '');
  if (!changed) return res.json(await studentProfile(id));

  await tx(async (c) => {
    await c.query(
      `UPDATE installments SET name_ar = $1, amount = $2, due_date = $3, notes = $4,
              updated_by = $5, updated_at = now() WHERE id = $6`,
      [name, amount, due, notes, req.user.id, instId]
    );
    await c.query(
      `INSERT INTO installment_changes
         (installment_id, old_name, new_name, old_amount, new_amount, old_due_date, new_due_date, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [instId, before.name_ar, name, before.amount, amount, before.due_date, due, reason, req.user.id]
    );
    await audit(c, req, {
      action: ACTIONS.INSTALLMENT_UPDATE, entity: 'installment', entityId: instId, studentId: id,
      description: `تعديل القسط «${before.name_ar}»`
        + (String(before.amount) !== String(Number(amount).toFixed(2))
          ? ` — القيمة من ${Number(before.amount).toFixed(2)} إلى ${Number(amount).toFixed(2)}` : '')
        + (reason ? ` — السبب: ${reason}` : ''),
      oldValues: { name: before.name_ar, amount: before.amount, due_date: before.due_date, notes: before.notes },
      newValues: { name, amount, due_date: due, notes, reason }
    });
  });

  res.json(await studentProfile(id));
}));

/** سجل دفعات قسط واحد */
r.get('/:id/installments/:instId/payments', requirePermission('payments.view'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const instId = v.intId(req.params.instId, 'القسط');

  const inst = await one(
    `SELECT st.*, i.enrollment_id FROM installment_status st
     JOIN installments i ON i.id = st.installment_id
     JOIN student_enrollments e ON e.id = i.enrollment_id
     WHERE st.installment_id = $1 AND e.student_id = $2`,
    [instId, id]
  );
  if (!inst) throw notFound('القسط غير موجود.');

  const payments = await many(
    `SELECT p.id, p.receipt_number, p.paid_at, p.status, p.void_reason, a.amount,
            m.name_ar AS method_name, u.full_name AS cashier, rc.id AS receipt_id
     FROM payment_allocations a
     JOIN payments p ON p.id = a.payment_id
     JOIN payment_methods m ON m.id = p.method_id
     JOIN users u ON u.id = p.created_by
     LEFT JOIN receipts rc ON rc.payment_id = p.id
     WHERE a.installment_id = $1 ORDER BY p.id`,
    [instId]
  );

  const changes = await many(
    `SELECT ic.*, u.full_name AS changed_by_name FROM installment_changes ic
     JOIN users u ON u.id = ic.changed_by WHERE ic.installment_id = $1 ORDER BY ic.id DESC`,
    [instId]
  );

  res.json({ installment: inst, payments, changes });
}));

r.delete('/:id/installments/:instId', requirePermission('installments.manage'), wrap(async (req, res) => {
  const id = v.intId(req.params.id, 'الطالب');
  const instId = v.intId(req.params.instId, 'القسط');
  const paid = await one('SELECT paid FROM installment_paid WHERE installment_id = $1', [instId]);
  if (Number(paid?.paid || 0) > 0) throw badRequest('لا يمكن حذف قسط سُددت عليه دفعات.');
  await tx(async (c) => {
    await c.query('DELETE FROM installments WHERE id = $1 AND enrollment_id IN (SELECT id FROM student_enrollments WHERE student_id = $2)', [instId, id]);
    await audit(c, req, { action: ACTIONS.INSTALLMENT_DELETE, entity: 'installment', entityId: instId, studentId: id, description: 'حذف قسط' });
  });
  res.json({ ok: true });
}));

export default r;
