import { pool, tx } from '../db.js';
import { migrate } from '../migrate.js';
import { PERMISSIONS, ROLES } from '../lib/permissions.js';
import { hashPassword } from '../middleware/auth.js';

export const DEFAULT_SETTINGS = {
  school_name: 'مدرسة شمس الوطن',
  school_name_en: 'SHAMS ALWATAN SCHOOL',
  school_short: 'S.H.S',
  school_address: '',
  school_phone: '',
  logo_path: '/logo.png',
  currency: 'د.ل',
  currency_code: 'LYD',
  timezone: 'Africa/Tripoli',
  receipt_prefix: 'SHW',
  student_prefix: 'STU',
  receipt_footer: 'هذا الإيصال دليل استلام المبلغ المذكور أعلاه.',
  date_format: 'dd/MM/yyyy'
};

const CLASSES = [
  'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
  'السادس', 'السابع', 'الثامن', 'التاسع'
];
const SECTIONS = ['أ', 'ب', 'ج'];

const FEE_TYPES = [
  ['tuition', 'الرسوم الدراسية', true, false, 1],
  ['registration', 'رسوم التسجيل', true, false, 2],
  ['uniform', 'الزي المدرسي', true, true, 3],
  ['extra', 'رسوم إضافية', true, true, 4]
];

const METHODS = [
  ['cash', 'نقدًا', 1],
  ['card', 'بطاقة', 2],
  ['transfer', 'تحويل مصرفي', 3]
];

export async function seed({ quiet = false, adminPassword } = {}) {
  await migrate({ quiet });

  await tx(async (c) => {
    // الصلاحيات
    for (const [code, name, group] of PERMISSIONS) {
      await c.query(
        `INSERT INTO permissions (code, name_ar, group_ar) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, group_ar = EXCLUDED.group_ar`,
        [code, name, group]
      );
    }
    // الأدوار وربطها بالصلاحيات
    for (const role of ROLES) {
      const { rows } = await c.query(
        `INSERT INTO roles (code, name_ar, is_system) VALUES ($1,$2,TRUE)
         ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar RETURNING id`,
        [role.code, role.name_ar]
      );
      const roleId = rows[0].id;
      await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2)`,
        [roleId, role.permissions]
      );
    }

    // الإعدادات
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
    }

    // السنة الدراسية الحالية
    await c.query(
      `INSERT INTO academic_years (name, is_current) VALUES ('2026/2027', TRUE)
       ON CONFLICT (name) DO NOTHING`
    );

    // الصفوف والفصول
    for (let i = 0; i < CLASSES.length; i++) {
      const { rows } = await c.query(
        `INSERT INTO classes (name_ar, sort_order) VALUES ($1,$2)
         ON CONFLICT (name_ar) DO UPDATE SET sort_order = EXCLUDED.sort_order RETURNING id`,
        [CLASSES[i], i + 1]
      );
      for (const s of SECTIONS) {
        await c.query(
          `INSERT INTO sections (class_id, name_ar) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [rows[0].id, s]
        );
      }
    }

    // أنواع الرسوم وطرق الدفع
    for (const [code, name, isSystem, optional, order] of FEE_TYPES) {
      await c.query(
        `INSERT INTO fee_types (code, name_ar, is_system, optional, sort_order) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar`,
        [code, name, isSystem, optional, order]
      );
    }
    for (const [code, name, order] of METHODS) {
      await c.query(
        `INSERT INTO payment_methods (code, name_ar, sort_order) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar`,
        [code, name, order]
      );
    }

    // حساب المدير الأول
    const { rows: exists } = await c.query("SELECT 1 FROM users WHERE role_id = (SELECT id FROM roles WHERE code='admin') LIMIT 1");
    if (!exists.length) {
      const pw = adminPassword || process.env.ADMIN_PASSWORD || 'Admin@2026';
      // لا نُجبر المدير على تغييرها: كلمة المرور هذه يضعها صاحب النظام بنفسه في .env،
      // بينما الإجبار مخصص لمن عيّن له شخصٌ آخر كلمة مروره.
      await c.query(
        `INSERT INTO users (full_name, username, password_hash, role_id, must_change_password)
         VALUES ($1,$2,$3,(SELECT id FROM roles WHERE code='admin'), FALSE)`,
        ['مدير النظام', 'admin', hashPassword(pw)]
      );
      if (!quiet) console.log(`  ✓ أُنشئ حساب المدير:  admin / ${pw}   (غيّر كلمة المرور بعد أول دخول)`);
    }
  });

  if (!quiet) console.log('  ✓ البيانات الأساسية جاهزة.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => pool.end())
    .catch((err) => { console.error('✗', err.message); process.exit(1); });
}
