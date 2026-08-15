/**
 * كتالوج الصلاحيات. مصدر واحد يستخدمه الـ seed والتحقق والواجهة.
 */
export const PERMISSIONS = [
  // الطلاب
  ['students.view', 'عرض الطلاب والبحث', 'الطلاب'],
  ['students.create', 'إضافة طالب', 'الطلاب'],
  ['students.update', 'تعديل بيانات طالب', 'الطلاب'],
  ['students.change_national_id', 'تغيير الرقم الوطني', 'الطلاب'],
  ['students.archive', 'أرشفة طالب', 'الطلاب'],
  // الرسوم
  ['fees.view', 'عرض الرسوم', 'الرسوم'],
  ['fees.update', 'تعديل الرسوم', 'الرسوم'],
  ['fees.discount', 'منح خصم', 'الرسوم'],
  ['installments.manage', 'إدارة الأقساط', 'الرسوم'],
  // الدفعات
  ['payments.view', 'عرض الدفعات', 'الدفعات'],
  ['payments.create', 'تسجيل دفعة', 'الدفعات'],
  ['payments.void', 'إلغاء دفعة', 'الدفعات'],
  ['receipts.print', 'طباعة الإيصالات', 'الدفعات'],
  // Excel
  ['excel.import', 'استيراد Excel', 'Excel'],
  // التقارير
  ['reports.view', 'عرض التقارير', 'التقارير'],
  ['reports.export', 'تصدير التقارير', 'التقارير'],
  // النظام
  ['audit.view', 'عرض سجل العمليات', 'النظام'],
  ['users.manage', 'إدارة المستخدمين والصلاحيات', 'النظام'],
  ['backup.manage', 'النسخ الاحتياطي', 'النظام'],
  ['backup.restore', 'استرجاع نسخة احتياطية', 'النظام'],
  ['settings.manage', 'إدارة الإعدادات', 'النظام']
];

export const ROLES = [
  {
    code: 'admin',
    name_ar: 'مدير النظام',
    permissions: PERMISSIONS.map(([c]) => c)          // كل الصلاحيات
  },
  {
    code: 'accountant',
    name_ar: 'محاسب',
    permissions: [
      'students.view', 'students.create', 'students.update',
      'fees.view', 'fees.update', 'fees.discount', 'installments.manage',
      'payments.view', 'payments.create', 'receipts.print',
      'excel.import', 'reports.view', 'reports.export', 'audit.view'
    ]
  },
  {
    code: 'data_entry',
    name_ar: 'إدخال بيانات',
    permissions: ['students.view', 'students.create', 'students.update', 'fees.view', 'excel.import']
  }
];

export default { PERMISSIONS, ROLES };
