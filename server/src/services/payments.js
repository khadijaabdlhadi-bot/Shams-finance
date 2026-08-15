import { nextReceiptNumber } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toMinor, toDecimalString } from '../lib/money.js';
import { audit, ACTIONS } from '../lib/audit.js';

/**
 * تسجيل دفعة — قلب النظام.
 * كل ما يلي داخل معاملة واحدة، وأي فشل يعني ROLLBACK كامل:
 * لا دفعة، لا إيصال، ولا رصيد نصف محدَّث.
 */
export async function recordPayment(client, req, input) {
  const { enrollmentId, amount, methodId, notes, allocations, settings } = input;

  // 1) قفل صف التسجيل: موظفان يسجلان لنفس الطالب في نفس اللحظة يصطفّان بدل التصادم
  const { rows: [enrollment] } = await client.query(
    `SELECT e.*, s.full_name, s.national_id, s.student_number, s.guardian_phone,
            y.name AS year_name, c.name_ar AS class_name, sec.name_ar AS section_name
     FROM student_enrollments e
     JOIN students s ON s.id = e.student_id
     JOIN academic_years y ON y.id = e.academic_year_id
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     WHERE e.id = $1
     FOR UPDATE OF e`,
    [enrollmentId]
  );
  if (!enrollment) throw notFound('تسجيل الطالب غير موجود.');

  // 2) الأرصدة تُقرأ من القاعدة، لا من الواجهة
  const { rows: [balance] } = await client.query(
    'SELECT * FROM enrollment_balances WHERE enrollment_id = $1', [enrollmentId]
  );
  const dueMinor = toMinor(balance.total_due);
  const paidMinor = toMinor(balance.total_paid);
  const remainingMinor = dueMinor - paidMinor;
  const amountMinor = toMinor(amount);

  // 3) قواعد المبلغ
  if (amountMinor <= 0) throw badRequest('قيمة الدفعة يجب أن تكون أكبر من صفر.');
  if (remainingMinor <= 0) throw badRequest('لا يوجد مبلغ متبقٍ على هذا الطالب.');
  if (amountMinor > remainingMinor) {
    throw badRequest(`قيمة الدفعة أكبر من المتبقي (${toDecimalString(remainingMinor)}).`);
  }

  const { rows: [method] } = await client.query('SELECT * FROM payment_methods WHERE id = $1 AND active', [methodId]);
  if (!method) throw badRequest('طريقة الدفع غير صحيحة.');

  // 4) التوزيع على البنود
  const feeRows = (await client.query(
    `SELECT f.id, f.amount, f.discount, f.required, t.code, t.name_ar, t.sort_order, fp.paid
     FROM student_fees f JOIN fee_types t ON t.id = f.fee_type_id
     JOIN fee_paid fp ON fp.student_fee_id = f.id
     WHERE f.enrollment_id = $1 ORDER BY t.sort_order`,
    [enrollmentId]
  )).rows;

  const installmentRows = (await client.query(
    `SELECT i.id, i.name_ar, i.amount, i.due_date, ip.paid
     FROM installments i JOIN installment_paid ip ON ip.installment_id = i.id
     WHERE i.enrollment_id = $1 ORDER BY i.sort_order`,
    [enrollmentId]
  )).rows;

  const alloc = allocations?.length
    ? validateAllocations(allocations, feeRows, amountMinor, installmentRows)
    : autoAllocate(feeRows, amountMinor);

  // إن كانت الدفعة على قسط، نضيف بيانات القسط إلى الإيصال
  const instAlloc = alloc.find((a) => a.installment_id);
  const instRow = instAlloc ? installmentRows.find((i) => i.id === instAlloc.installment_id) : null;

  // 5) حجز رقم الإيصال ذريًا داخل نفس المعاملة
  const yearNumber = Number(String(enrollment.year_name).slice(0, 4)) || new Date().getFullYear();
  const receiptNumber = await nextReceiptNumber(client, yearNumber, settings.receipt_prefix || 'SHW');

  // 6) الدفعة
  const { rows: [payment] } = await client.query(
    `INSERT INTO payments (receipt_number, student_id, enrollment_id, amount, method_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [receiptNumber, enrollment.student_id, enrollmentId, toDecimalString(amountMinor), methodId,
      notes || null, req.user.id]
  );

  // 7) التوزيع
  for (const a of alloc) {
    await client.query(
      `INSERT INTO payment_allocations (payment_id, student_fee_id, installment_id, amount)
       VALUES ($1,$2,$3,$4)`,
      [payment.id, a.student_fee_id || null, a.installment_id || null, toDecimalString(a.minor)]
    );
  }

  // 8) الإيصال: لقطة كاملة لحالة الطالب لحظة الدفع (لا تتأثر بأي تعديل لاحق)
  const snapshot = {
    receipt_number: receiptNumber,
    school: {
      name: settings.school_name, name_en: settings.school_name_en,
      address: settings.school_address, phone: settings.school_phone, logo: settings.logo_path
    },
    student: {
      id: enrollment.student_id, full_name: enrollment.full_name,
      national_id: enrollment.national_id, student_number: enrollment.student_number,
      guardian_phone: enrollment.guardian_phone,
      class_name: enrollment.class_name, section_name: enrollment.section_name,
      academic_year: enrollment.year_name
    },
    payment: {
      amount: toDecimalString(amountMinor),
      method: method.name_ar, method_code: method.code,
      notes: notes || null, paid_at: payment.paid_at
    },
    balances: {
      total_due: toDecimalString(dueMinor),
      paid_before: toDecimalString(paidMinor),
      this_payment: toDecimalString(amountMinor),
      paid_after: toDecimalString(paidMinor + amountMinor),
      remaining_before: toDecimalString(remainingMinor),
      remaining_after: toDecimalString(remainingMinor - amountMinor)
    },
    allocations: alloc.map((a) => ({ label: a.label, amount: toDecimalString(a.minor) })),
    installment: instRow ? {
      id: instRow.id,
      name: instRow.name_ar,
      amount: toDecimalString(toMinor(instRow.amount)),
      paid_before: toDecimalString(toMinor(instRow.paid)),
      this_payment: toDecimalString(instAlloc.minor),
      paid_after: toDecimalString(toMinor(instRow.paid) + instAlloc.minor),
      remaining_after: toDecimalString(toMinor(instRow.amount) - toMinor(instRow.paid) - instAlloc.minor),
      due_date: instRow.due_date
    } : null,
    cashier: { id: req.user.id, name: req.user.full_name, username: req.user.username },
    currency: settings.currency || 'د.ل',
    footer: settings.receipt_footer || ''
  };

  const { rows: [receipt] } = await client.query(
    `INSERT INTO receipts (payment_id, receipt_number, snapshot, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [payment.id, receiptNumber, JSON.stringify(snapshot), req.user.id]
  );

  // 9) السجل — داخل نفس المعاملة
  await audit(client, req, {
    action: ACTIONS.PAYMENT_CREATE, entity: 'payment', entityId: payment.id, studentId: enrollment.student_id,
    description: `تسجيل دفعة ${toDecimalString(amountMinor)} ${settings.currency || ''} (${method.name_ar})`
      + `${instRow ? ` على «${instRow.name_ar}»` : ''} — إيصال ${receiptNumber}`,
    newValues: {
      amount: toDecimalString(amountMinor), method: method.name_ar, receipt_number: receiptNumber,
      remaining_after: snapshot.balances.remaining_after
    }
  });
  await audit(client, req, {
    action: ACTIONS.RECEIPT_ISSUE, entity: 'receipt', entityId: receipt.id, studentId: enrollment.student_id,
    description: `إصدار الإيصال ${receiptNumber}`
  });

  return { payment, receipt, snapshot };
}

/** توزيع تلقائي: يملأ البنود بالترتيب حتى ينتهي المبلغ. */
export function autoAllocate(feeRows, amountMinor) {
  let left = amountMinor;
  const out = [];
  for (const f of feeRows) {
    if (left <= 0) break;
    if (!f.required) continue;
    const net = toMinor(f.amount) - toMinor(f.discount);
    const remaining = net - toMinor(f.paid);
    if (remaining <= 0) continue;
    const take = Math.min(remaining, left);
    out.push({ student_fee_id: f.id, minor: take, label: f.name_ar });
    left -= take;
  }
  if (left > 0) {
    // احتياط: يحدث فقط لو كان المستحق غير مغطى ببنود (لا يفترض حدوثه)
    const first = feeRows.find((f) => f.required);
    if (!first) throw badRequest('لا توجد بنود رسوم لتوزيع الدفعة عليها.');
    out.push({ student_fee_id: first.id, minor: left, label: first.name_ar });
  }
  return out;
}

/** توزيع يدوي: مجموع البنود يجب أن يساوي مبلغ الدفعة بالضبط. */
export function validateAllocations(allocations, feeRows, amountMinor, installmentRows = []) {
  const byId = Object.fromEntries(feeRows.map((f) => [f.id, f]));
  const instById = Object.fromEntries(installmentRows.map((i) => [i.id, i]));
  let sum = 0;
  const out = [];
  for (const a of allocations) {
    const minor = toMinor(a.amount);
    if (minor <= 0) throw badRequest('كل بند في التوزيع يجب أن يكون أكبر من صفر.');
    if (a.student_fee_id) {
      const f = byId[Number(a.student_fee_id)];
      if (!f) throw badRequest('أحد بنود التوزيع لا يخص هذا الطالب.');
      const remaining = toMinor(f.amount) - toMinor(f.discount) - toMinor(f.paid);
      if (minor > remaining) {
        throw badRequest(`المبلغ الموزّع على «${f.name_ar}» أكبر من المتبقي عليه (${toDecimalString(remaining)}).`);
      }
      out.push({ student_fee_id: f.id, minor, label: f.name_ar });
    } else if (a.installment_id) {
      const inst = instById[Number(a.installment_id)];
      if (installmentRows.length && !inst) throw badRequest('هذا القسط لا يخص هذا الطالب.');
      if (inst) {
        const remaining = toMinor(inst.amount) - toMinor(inst.paid);
        if (remaining <= 0) {
          throw badRequest(`القسط «${inst.name_ar}» مدفوع بالكامل — لا يمكن تسجيل دفعة إضافية عليه.`);
        }
        if (minor > remaining) {
          throw badRequest(`المبلغ أكبر من المتبقي على القسط «${inst.name_ar}» (${toDecimalString(remaining)}).`);
        }
      }
      out.push({ installment_id: Number(a.installment_id), minor, label: inst?.name_ar || a.label || 'قسط' });
    } else {
      throw badRequest('بند التوزيع يجب أن يرتبط برسم أو قسط.');
    }
    sum += minor;
  }
  if (sum !== amountMinor) {
    throw badRequest(`مجموع التوزيع (${toDecimalString(sum)}) لا يساوي قيمة الدفعة (${toDecimalString(amountMinor)}).`);
  }
  return out;
}

/** إلغاء دفعة — لا حذف أبدًا. */
export async function voidPayment(client, req, paymentId, reason) {
  const { rows: [payment] } = await client.query(
    `SELECT p.*, s.full_name FROM payments p JOIN students s ON s.id = p.student_id
     WHERE p.id = $1 FOR UPDATE OF p`,
    [paymentId]
  );
  if (!payment) throw notFound('الدفعة غير موجودة.');
  if (payment.status === 'void') throw badRequest('هذه الدفعة ملغاة مسبقًا.');

  await client.query(
    `UPDATE payments SET status = 'void', void_reason = $1, voided_by = $2, voided_at = now() WHERE id = $3`,
    [reason, req.user.id, paymentId]
  );
  await client.query(`UPDATE receipts SET status = 'void' WHERE payment_id = $1`, [paymentId]);

  await audit(client, req, {
    action: ACTIONS.PAYMENT_VOID, entity: 'payment', entityId: paymentId, studentId: payment.student_id,
    description: `إلغاء الدفعة ${payment.amount} — إيصال ${payment.receipt_number} — السبب: ${reason}`,
    oldValues: { status: 'active', amount: payment.amount },
    newValues: { status: 'void', reason }
  });

  return payment;
}

export default { recordPayment, voidPayment, autoAllocate, validateAllocations };
