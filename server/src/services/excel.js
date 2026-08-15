import ExcelJS from 'exceljs';
import v from '../lib/validate.js';
import { toMinor } from '../lib/money.js';

/** أعمدة النموذج الرسمي — بالترتيب المطلوب في المواصفات. */
export const TEMPLATE_COLUMNS = [
  { key: 'national_id', label: 'الرقم الوطني', width: 20, text: true, required: true },
  { key: 'full_name', label: 'اسم الطالب', width: 28, required: true },
  { key: 'guardian_phone', label: 'هاتف ولي الأمر', width: 18, text: true },
  { key: 'extra_phone', label: 'هاتف إضافي', width: 18, text: true },
  { key: 'class_name', label: 'الصف', width: 14 },
  { key: 'section_name', label: 'الفصل', width: 10 },
  { key: 'year_name', label: 'السنة الدراسية', width: 15 },
  { key: 'tuition_fee', label: 'الرسوم الدراسية', width: 16, money: true },
  { key: 'registration_fee', label: 'رسوم التسجيل', width: 16, money: true },
  { key: 'uniform_fee', label: 'سعر الزي', width: 14, money: true },
  { key: 'uniform_required', label: 'هل الزي مطلوب؟', width: 16 },
  { key: 'extra_fee', label: 'رسوم إضافية', width: 14, money: true },
  { key: 'discount', label: 'الخصم', width: 12, money: true },
  { key: 'notes', label: 'ملاحظات', width: 26 }
];

/** بناء ملف النموذج مع صف مثال وتنسيق نصي للأعمدة الحساسة. */
export async function buildTemplate(settings, { classes = [], year = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.school_name || 'المنظومة المالية';
  const ws = wb.addWorksheet('الطلاب', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF5FB' } };
  ws.getRow(1).height = 22;

  // الأعمدة النصية: نمنع Excel من حذف الأصفار في البداية
  for (const [i, c] of TEMPLATE_COLUMNS.entries()) {
    if (c.text) ws.getColumn(i + 1).numFmt = '@';
    if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00';
  }

  ws.addRow({
    national_id: '0012345678901',
    full_name: 'محمد أحمد علي',
    guardian_phone: '0912345678',
    extra_phone: '',
    class_name: classes[0] || 'الأول',
    section_name: 'أ',
    year_name: year || '2026/2027',
    tuition_fee: 2000,
    registration_fee: 150,
    uniform_fee: 120,
    uniform_required: 'نعم',
    extra_fee: 0,
    discount: 0,
    notes: 'صف المثال — احذفه قبل الرفع'
  });

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 100 }];
  [
    'تعليمات تعبئة الملف:',
    '١) لا تغيّر أسماء الأعمدة ولا ترتيبها.',
    '٢) الرقم الوطني وأرقام الهواتف تُكتب كنص — الأصفار في البداية مهمة ولا يجوز حذفها.',
    '٣) الرقم الوطني إلزامي ولا يجوز تكراره؛ سيرفض النظام أي تكرار.',
    '٤) اسم الطالب إلزامي.',
    '٥) المبالغ أرقام فقط وبدون رموز عملة، ولا تقبل القيم السالبة.',
    '٦) «هل الزي مطلوب؟» اكتب: نعم / لا.',
    '٧) الخصم لا يجوز أن يتجاوز الرسوم الدراسية.',
    '٨) احذف صف المثال قبل رفع الملف.',
    '٩) بعد الرفع سيعرض النظام معاينة وفحصًا لكل صف قبل الحفظ — لا يُحفظ شيء قبل تأكيدك.'
  ].forEach((line) => help.addRow([line]));
  help.getRow(1).font = { bold: true, size: 13 };

  return wb;
}

/** قراءة خلية كنص خام — يحافظ على الأصفار في البداية. */
export function cellText(cell) {
  if (cell === null || cell === undefined) return '';
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.text !== undefined) return String(val.text).trim();
    if (val.result !== undefined) return String(val.result).trim();
    if (val.richText) return val.richText.map((t) => t.text).join('').trim();
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return '';
  }
  if (typeof val === 'number') {
    // Excel قد يحوّل رقمًا وطنيًا إلى رقم — نعيده نصًا بلا صيغة علمية
    return Number.isInteger(val) ? String(val) : String(val);
  }
  return String(val).trim();
}

/** قراءة الملف: أسماء الأعمدة + كل الصفوف كنصوص. */
export async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('الملف لا يحتوي على أي ورقة بيانات.');

  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellText(cell); });

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, index) => {
    if (index === 1) return;
    const obj = {};
    let empty = true;
    headers.forEach((h, i) => {
      const text = cellText(row.getCell(i + 1));
      obj[h || `col_${i + 1}`] = text;
      if (text) empty = false;
    });
    if (!empty) rows.push({ row_number: index, values: obj });
  });

  return { headers: headers.filter(Boolean), rows };
}

/** ربط تلقائي للأعمدة بالاعتماد على أسماء النموذج. */
export function autoMapping(headers) {
  const map = {};
  for (const col of TEMPLATE_COLUMNS) {
    const found = headers.find((h) => normalize(h) === normalize(col.label));
    if (found) map[col.key] = found;
  }
  return map;
}

const normalize = (s) => String(s || '').replace(/[\s_ـ]/g, '').replace(/[؟?]/g, '').trim();

const YES = ['نعم', 'yes', 'true', '1', 'y', 'مطلوب', 'صح'];

/**
 * فحص كل صف. لا يُحفظ شيء هنا — هذه مرحلة المعاينة فقط.
 * الحالات: ready | duplicate_in_file | exists | missing | error
 */
export function validateRows(rows, mapping, { existingIds = new Set(), classesByName = {}, sectionsByKey = {} } = {}) {
  const seen = new Map();
  const out = [];

  for (const { row_number, values } of rows) {
    const get = (key) => (mapping[key] ? String(values[mapping[key]] ?? '').trim() : '');
    const issues = [];
    let status = 'ready';

    let nationalId = null;
    try {
      nationalId = v.nationalId(get('national_id'));
    } catch (err) {
      issues.push(err.message);
      status = 'missing';
    }

    const fullName = get('full_name').trim();
    if (!fullName) { issues.push('اسم الطالب مفقود.'); status = 'missing'; }

    const money = {};
    for (const key of ['tuition_fee', 'registration_fee', 'uniform_fee', 'extra_fee', 'discount']) {
      const raw = get(key);
      if (!raw) { money[key] = '0.00'; continue; }
      try {
        const normalized = v.normalizeDigits(raw).replace(/[,\s٬]/g, '').trim();
        // نص غير رقمي لا يُقرأ كصفر بصمت — يُعتبر خطأ صريحًا في الصف
        if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
          issues.push(`${labelOf(key)} قيمة غير صحيحة.`);
          status = 'error';
          money[key] = '0.00';
          continue;
        }
        const minor = toMinor(normalized);
        if (minor < 0) { issues.push(`${labelOf(key)} قيمة سالبة.`); status = 'error'; }
        money[key] = (minor / 100).toFixed(2);
      } catch {
        issues.push(`${labelOf(key)} قيمة غير صحيحة.`);
        status = 'error';
      }
    }

    if (Number(money.discount) > Number(money.tuition_fee)) {
      issues.push('الخصم أكبر من الرسوم الدراسية.');
      status = 'error';
    }

    let guardianPhone = null; let extraPhone = null;
    try { guardianPhone = v.phone(get('guardian_phone'), { label: 'هاتف ولي الأمر' }); }
    catch (err) { issues.push(err.message); status = status === 'ready' ? 'error' : status; }
    try { extraPhone = v.phone(get('extra_phone'), { label: 'الهاتف الإضافي' }); }
    catch (err) { issues.push(err.message); status = status === 'ready' ? 'error' : status; }

    if (nationalId) {
      if (seen.has(nationalId)) {
        issues.push(`مكرر داخل الملف مع الصف ${seen.get(nationalId)}.`);
        status = 'duplicate_in_file';
      } else if (existingIds.has(nationalId)) {
        issues.push('هذا الرقم الوطني مسجل مسبقًا في النظام.');
        status = 'exists';
      } else {
        seen.set(nationalId, row_number);
      }
    }

    const className = get('class_name');
    const classId = className ? classesByName[normalize(className)] : null;
    if (className && !classId) issues.push(`الصف «${className}» غير معرّف في النظام — سيُترك فارغًا.`);
    const sectionName = get('section_name');
    const sectionId = classId && sectionName ? sectionsByKey[`${classId}:${normalize(sectionName)}`] : null;

    out.push({
      row_number,
      status,
      issues,
      data: {
        national_id: nationalId,
        full_name: fullName,
        guardian_phone: guardianPhone,
        extra_phone: extraPhone,
        class_id: classId || null,
        class_name: className || null,
        section_id: sectionId || null,
        section_name: sectionName || null,
        notes: get('notes') || null,
        uniform_required: YES.includes(get('uniform_required').toLowerCase()),
        ...money
      }
    });
  }

  return out;
}

const LABELS = {
  tuition_fee: 'الرسوم الدراسية', registration_fee: 'رسوم التسجيل',
  uniform_fee: 'سعر الزي', extra_fee: 'الرسوم الإضافية', discount: 'الخصم'
};
const labelOf = (k) => LABELS[k] || k;

export const STATUS_LABELS = {
  ready: 'جاهز',
  duplicate_in_file: 'مكرر في الملف',
  exists: 'موجود مسبقًا',
  missing: 'بيانات ناقصة',
  error: 'خطأ'
};

export default { TEMPLATE_COLUMNS, buildTemplate, readWorkbook, autoMapping, validateRows, STATUS_LABELS };
