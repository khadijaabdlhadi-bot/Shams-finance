-- ============================================================
--  002 — تطوير الأقساط والقسم المالي
--  ترحيل إضافي فقط: لا يحذف أي جدول ولا أي بيانات قائمة.
-- ============================================================

-- ---------- الأقساط: ملاحظات وتتبّع التعديل ----------
ALTER TABLE installments ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE installments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- سجل تعديل الأقساط: كل تغيير في القيمة أو الاسم أو تاريخ الاستحقاق بسببه ومنفّذه
CREATE TABLE IF NOT EXISTS installment_changes (
  id             SERIAL PRIMARY KEY,
  installment_id INTEGER NOT NULL REFERENCES installments(id) ON DELETE CASCADE,
  old_name       TEXT,
  new_name       TEXT,
  old_amount     NUMERIC(14,2),
  new_amount     NUMERIC(14,2),
  old_due_date   DATE,
  new_due_date   DATE,
  reason         TEXT,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installment_changes_inst ON installment_changes (installment_id);

-- ---------- عرض حالة كل قسط (محسوبة، غير مخزّنة) ----------
CREATE OR REPLACE VIEW installment_status AS
SELECT i.id                AS installment_id,
       i.enrollment_id,
       i.name_ar,
       i.amount,
       i.due_date,
       i.sort_order,
       i.notes,
       ip.paid,
       GREATEST(i.amount - ip.paid, 0)::NUMERIC(14,2) AS remaining,
       CASE
         WHEN ip.paid >= i.amount THEN 'paid'
         WHEN i.due_date IS NOT NULL AND i.due_date < current_date AND ip.paid < i.amount THEN 'late'
         WHEN ip.paid > 0 THEN 'partial'
         WHEN i.due_date IS NOT NULL AND i.due_date <= current_date THEN 'due'
         ELSE 'unpaid'
       END AS status,
       CASE WHEN i.amount > 0
            THEN LEAST(100, ROUND(100.0 * ip.paid / i.amount))::INTEGER
            ELSE 0 END AS percent
FROM installments i
JOIN installment_paid ip ON ip.installment_id = i.id;

-- ---------- حركة الخزينة ----------
-- كل دفعة نشطة = حركة داخلة (+)، وكل دفعة ملغاة = حركة عكسية (−) بنفس القيمة.
-- محسوبة من جدول الدفعات نفسه ⇒ لا يمكن أن تختلف الخزينة عن الدفعات أبدًا.
CREATE OR REPLACE VIEW treasury_movements AS
SELECT p.id                                   AS payment_id,
       'in'::TEXT                             AS direction,
       p.amount                               AS amount,
       p.paid_at                              AS happened_at,
       p.receipt_number,
       p.student_id,
       p.method_id,
       p.created_by                           AS user_id,
       p.status,
       'دفعة طالب'::TEXT                       AS kind
FROM payments p
UNION ALL
SELECT p.id, 'out', p.amount, p.voided_at, p.receipt_number, p.student_id, p.method_id,
       p.voided_by, p.status, 'إلغاء دفعة'
FROM payments p
WHERE p.status = 'void' AND p.voided_at IS NOT NULL;
