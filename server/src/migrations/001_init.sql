-- ============================================================
--  المنظومة المالية — مدرسة شمس الوطن
--  001 — المخطط الأساسي
--  كل المبالغ NUMERIC(14,2) — ممنوع FLOAT
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- الإعدادات ----------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_by  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- عدّادات الأرقام التسلسلية (توليد ذرّي) ----------
CREATE TABLE counters (
  scope   TEXT    NOT NULL,          -- 'student' | 'receipt'
  year    INTEGER NOT NULL,
  value   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, year)
);

-- ---------- الأدوار والصلاحيات ----------
CREATE TABLE roles (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,   -- admin | accountant | data_entry
  name_ar    TEXT NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name_ar  TEXT NOT NULL,
  group_ar TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------- المستخدمون ----------
CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  full_name      TEXT NOT NULL,
  username       TEXT NOT NULL,
  username_lower TEXT GENERATED ALWAYS AS (lower(username)) STORED,
  email          TEXT,
  password_hash  TEXT NOT NULL,
  role_id        INTEGER NOT NULL REFERENCES roles(id),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_unique ON users (username_lower);

-- ---------- السنوات الدراسية والصفوف ----------
CREATE TABLE academic_years (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,        -- 2026/2027
  starts_on  DATE,
  ends_on    DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX academic_years_one_current
  ON academic_years ((is_current)) WHERE is_current;

CREATE TABLE classes (
  id         SERIAL PRIMARY KEY,
  name_ar    TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE sections (
  id       SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name_ar  TEXT NOT NULL,
  active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (class_id, name_ar)
);

-- ---------- الطلاب ----------
CREATE TABLE students (
  id             SERIAL PRIMARY KEY,
  student_number TEXT NOT NULL UNIQUE,            -- STU-2026-000001
  national_id    VARCHAR(32) NOT NULL,            -- نص وليس رقمًا: الأصفار محفوظة
  full_name      TEXT NOT NULL,
  guardian_name  TEXT,
  guardian_phone TEXT,
  extra_phone    TEXT,
  gender         TEXT CHECK (gender IN ('male','female')),
  birth_date     DATE,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','archived','transferred')),
  archived_at    TIMESTAMPTZ,
  archived_by    INTEGER REFERENCES users(id),
  archive_reason TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- القيد الحاسم: لا رقم وطني مكرر، على مستوى القاعدة نفسها
CREATE UNIQUE INDEX students_national_id_unique ON students (national_id);
CREATE INDEX students_name_trgm   ON students USING gin (full_name gin_trgm_ops);
CREATE INDEX students_guardian    ON students (guardian_phone);
CREATE INDEX students_extra_phone ON students (extra_phone);
CREATE INDEX students_status      ON students (status);

-- ---------- التسجيل في سنة دراسية ----------
CREATE TABLE student_enrollments (
  id               SERIAL PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id         INTEGER REFERENCES classes(id),
  section_id       INTEGER REFERENCES sections(id),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','left','archived')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       INTEGER REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrollments_year  ON student_enrollments (academic_year_id);
CREATE INDEX enrollments_class ON student_enrollments (class_id, section_id);

-- ---------- أنواع الرسوم ----------
CREATE TABLE fee_types (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,      -- tuition | registration | uniform | extra
  name_ar    TEXT NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  optional   BOOLEAN NOT NULL DEFAULT FALSE,   -- الزي مثلًا قد لا يكون مطلوبًا
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- رسوم الطالب ----------
CREATE TABLE student_fees (
  id              SERIAL PRIMARY KEY,
  enrollment_id   INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
  fee_type_id     INTEGER NOT NULL REFERENCES fee_types(id),
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  discount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  discount_reason TEXT,
  discount_by     INTEGER REFERENCES users(id),
  discount_at     TIMESTAMPTZ,
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      INTEGER REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, fee_type_id),
  CHECK (discount <= amount)
);
CREATE INDEX student_fees_enrollment ON student_fees (enrollment_id);

-- سجل تعديل الرسوم والخصومات (لكل تعديل سبب ومنفّذ)
CREATE TABLE fee_changes (
  id             SERIAL PRIMARY KEY,
  student_fee_id INTEGER NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  old_amount     NUMERIC(14,2) NOT NULL,
  new_amount     NUMERIC(14,2) NOT NULL,
  old_discount   NUMERIC(14,2) NOT NULL,
  new_discount   NUMERIC(14,2) NOT NULL,
  reason         TEXT NOT NULL,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- الأقساط (اختيارية) ----------
CREATE TABLE installments (
  id            SERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
  name_ar       TEXT NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date      DATE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX installments_enrollment ON installments (enrollment_id);

-- ---------- طرق الدفع ----------
CREATE TABLE payment_methods (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,     -- cash | card | transfer
  name_ar    TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- الدفعات ----------
CREATE TABLE payments (
  id             SERIAL PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,          -- SHW-2026-000001
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id  INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method_id      INTEGER NOT NULL REFERENCES payment_methods(id),
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),   -- وقت الخادم دائمًا
  void_reason    TEXT,
  voided_by      INTEGER REFERENCES users(id),
  voided_at      TIMESTAMPTZ,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_student    ON payments (student_id);
CREATE INDEX payments_enrollment ON payments (enrollment_id);
CREATE INDEX payments_created    ON payments (created_at);
CREATE INDEX payments_paid_at    ON payments (paid_at);
CREATE INDEX payments_created_by ON payments (created_by);
CREATE INDEX payments_status     ON payments (status);

-- توزيع الدفعة على بنود الرسوم / الأقساط
CREATE TABLE payment_allocations (
  id             SERIAL PRIMARY KEY,
  payment_id     INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  student_fee_id INTEGER REFERENCES student_fees(id) ON DELETE RESTRICT,
  installment_id INTEGER REFERENCES installments(id) ON DELETE RESTRICT,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  CHECK (student_fee_id IS NOT NULL OR installment_id IS NOT NULL)
);
CREATE INDEX allocations_payment ON payment_allocations (payment_id);
CREATE INDEX allocations_fee     ON payment_allocations (student_fee_id);

-- ---------- الإيصالات (لقطة وقت الدفع) ----------
CREATE TABLE receipts (
  id             SERIAL PRIMARY KEY,
  payment_id     INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  snapshot       JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  print_count    INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receipts_number ON receipts (receipt_number);

-- ---------- سجل العمليات ----------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  username    TEXT,
  full_name   TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  student_id  INTEGER REFERENCES students(id) ON DELETE SET NULL,
  description TEXT,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_created ON audit_logs (created_at DESC);
CREATE INDEX audit_user    ON audit_logs (user_id);
CREATE INDEX audit_entity  ON audit_logs (entity, entity_id);
CREATE INDEX audit_student ON audit_logs (student_id);
CREATE INDEX audit_action  ON audit_logs (action);

-- ---------- استيراد Excel ----------
CREATE TABLE excel_imports (
  id               SERIAL PRIMARY KEY,
  filename         TEXT NOT NULL,
  academic_year_id INTEGER REFERENCES academic_years(id),
  total_rows       INTEGER NOT NULL DEFAULT 0,
  imported         INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0,
  duplicates       INTEGER NOT NULL DEFAULT 0,
  errors           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'completed',
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE excel_import_errors (
  id          SERIAL PRIMARY KEY,
  import_id   INTEGER NOT NULL REFERENCES excel_imports(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,
  national_id TEXT,
  full_name   TEXT,
  reason_code TEXT NOT NULL,
  message     TEXT NOT NULL,
  raw         JSONB
);
CREATE INDEX import_errors_import ON excel_import_errors (import_id);

-- ---------- النسخ الاحتياطي ----------
CREATE TABLE backups (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  size_bytes  BIGINT,
  kind        TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','auto','pre_restore')),
  status      TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','running')),
  message     TEXT,
  sha256      TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
--  Views — الأرصدة تُحسب ولا تُخزَّن
-- ============================================================

-- إجمالي المستحق لكل تسجيل (الرسوم المطلوبة فقط، ناقص الخصم)
CREATE VIEW enrollment_due AS
SELECT e.id AS enrollment_id,
       COALESCE(SUM(CASE WHEN f.required THEN f.amount - f.discount ELSE 0 END), 0)::NUMERIC(14,2) AS total_due,
       COALESCE(SUM(CASE WHEN f.required THEN f.discount ELSE 0 END), 0)::NUMERIC(14,2) AS total_discount
FROM student_enrollments e
LEFT JOIN student_fees f ON f.enrollment_id = e.id
GROUP BY e.id;

-- إجمالي المدفوع (الدفعات النشطة فقط — الملغاة لا تُحتسب)
CREATE VIEW enrollment_paid AS
SELECT e.id AS enrollment_id,
       COALESCE(SUM(CASE WHEN p.status = 'active' THEN p.amount ELSE 0 END), 0)::NUMERIC(14,2) AS total_paid,
       COUNT(p.id) FILTER (WHERE p.status = 'active') AS payment_count
FROM student_enrollments e
LEFT JOIN payments p ON p.enrollment_id = e.id
GROUP BY e.id;

-- الحساب المالي الكامل + حالة الدفع (محسوبة تلقائيًا)
CREATE VIEW enrollment_balances AS
SELECT e.id                AS enrollment_id,
       e.student_id,
       e.academic_year_id,
       d.total_due,
       d.total_discount,
       p.total_paid,
       (d.total_due - p.total_paid)::NUMERIC(14,2) AS balance,
       p.payment_count,
       CASE
         WHEN d.total_due <= 0 AND p.total_paid <= 0 THEN 'unpaid'
         WHEN p.total_paid >= d.total_due            THEN 'paid'
         WHEN p.total_paid > 0                       THEN 'partial'
         ELSE 'unpaid'
       END AS payment_status
FROM student_enrollments e
JOIN enrollment_due  d ON d.enrollment_id = e.id
JOIN enrollment_paid p ON p.enrollment_id = e.id;

-- المدفوع لكل بند رسوم (من التوزيع)
CREATE VIEW fee_paid AS
SELECT f.id AS student_fee_id,
       COALESCE(SUM(CASE WHEN p.status = 'active' THEN a.amount ELSE 0 END), 0)::NUMERIC(14,2) AS paid
FROM student_fees f
LEFT JOIN payment_allocations a ON a.student_fee_id = f.id
LEFT JOIN payments p ON p.id = a.payment_id
GROUP BY f.id;

-- المدفوع لكل قسط
CREATE VIEW installment_paid AS
SELECT i.id AS installment_id,
       COALESCE(SUM(CASE WHEN p.status = 'active' THEN a.amount ELSE 0 END), 0)::NUMERIC(14,2) AS paid
FROM installments i
LEFT JOIN payment_allocations a ON a.installment_id = i.id
LEFT JOIN payments p ON p.id = a.payment_id
GROUP BY i.id;
