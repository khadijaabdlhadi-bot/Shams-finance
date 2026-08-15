/**
 * صفحة الإيصال — عربية RTL، مصممة للطباعة على A5 داخل ورقة A4.
 * نفس الملف يُستخدم للعرض والطباعة وتحويل PDF (يرسمه محرك المتصفح ⇒ العربية سليمة).
 */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (v, cur) => {
  const [i, f = '00'] = String(v ?? '0').split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f} ${cur || ''}`.trim();
};

function fmtDateTime(value, tz = 'Africa/Tripoli') {
  const d = value ? new Date(value) : new Date();
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  return { date, time, full: `${date} – ${time}` };
}

export function renderReceiptHtml(receipt, { copies = 1, reprint = false, timezone = 'Africa/Tripoli', logo = null } = {}) {
  const s = receipt.snapshot;
  // الشعار يُمرَّر كـ data URI: صفحة الطباعة قد تُفتح من blob فلا تحل المسارات النسبية
  const logoSrc = logo || (s.school?.logo && s.school.logo.startsWith('data:') ? s.school.logo : null);
  const cur = s.currency || '';
  const when = fmtDateTime(s.payment?.paid_at, timezone);
  const isVoid = receipt.status === 'void';

  const row = (label, value, strong = false) => `
    <tr><th>${esc(label)}</th><td${strong ? ' class="strong"' : ''}>${esc(value)}</td></tr>`;

  const allocations = (s.allocations || []).map((a) => `
    <tr><td>${esc(a.label)}</td><td class="num">${esc(money(a.amount, cur))}</td></tr>`).join('');

  const body = `
  <div class="receipt${isVoid ? ' is-void' : ''}">
    ${isVoid ? '<div class="void-stamp">ملغي</div>' : ''}
    ${reprint ? '<div class="reprint">نسخة معادة الطباعة</div>' : ''}

    <header>
      ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="">` : '<div class="logo-ph">S.H.S</div>'}
      <div class="head-text">
        <h1>${esc(s.school?.name || 'مدرسة شمس الوطن')}</h1>
        ${s.school?.name_en ? `<div class="en">${esc(s.school.name_en)}</div>` : ''}
        <div class="sub">${esc([s.school?.address, s.school?.phone].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="rcpt-no">
        <span>رقم الإيصال</span>
        <b>${esc(s.receipt_number)}</b>
      </div>
    </header>

    <h2 class="title">إيصال دفع</h2>

    <div class="cols">
      <table class="info">
        ${row('اسم الطالب', s.student?.full_name)}
        ${row('الرقم الوطني', s.student?.national_id)}
        ${row('رقم الطالب', s.student?.student_number)}
        ${row('الصف / الفصل', [s.student?.class_name, s.student?.section_name].filter(Boolean).join(' - ') || '—')}
      </table>
      <table class="info">
        ${row('السنة الدراسية', s.student?.academic_year)}
        ${row('هاتف ولي الأمر', s.student?.guardian_phone || '—')}
        ${row('التاريخ', when.date)}
        ${row('الوقت', when.time)}
      </table>
    </div>

    <div class="amount-box">
      <div class="label">قيمة الدفعة</div>
      <div class="value">${esc(money(s.payment?.amount, cur))}</div>
      <div class="method">طريقة الدفع: <b>${esc(s.payment?.method)}</b></div>
    </div>

    ${allocations ? `
    <table class="alloc">
      <thead><tr><th>البند</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${allocations}</tbody>
    </table>` : ''}

    <table class="totals">
      <tr><th>إجمالي المستحق</th><td class="num">${esc(money(s.balances?.total_due, cur))}</td></tr>
      <tr><th>المدفوع سابقًا</th><td class="num">${esc(money(s.balances?.paid_before, cur))}</td></tr>
      <tr><th>الدفعة الحالية</th><td class="num strong">${esc(money(s.balances?.this_payment, cur))}</td></tr>
      <tr><th>إجمالي المدفوع</th><td class="num">${esc(money(s.balances?.paid_after, cur))}</td></tr>
      <tr class="rest"><th>المتبقي</th><td class="num strong">${esc(money(s.balances?.remaining_after, cur))}</td></tr>
    </table>

    ${s.payment?.notes ? `<div class="notes"><b>ملاحظات:</b> ${esc(s.payment.notes)}</div>` : ''}

    <div class="signs">
      <div><span>الموظف</span><b>${esc(s.cashier?.name || '')}</b><i>التوقيع</i></div>
      <div><span>ولي الأمر</span><b>&nbsp;</b><i>التوقيع</i></div>
      <div class="stamp"><span>الختم</span></div>
    </div>

    <footer>${esc(s.footer || '')}</footer>
  </div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>إيصال ${esc(s.receipt_number)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Cairo", "Noto Naskh Arabic", "Tahoma", "DejaVu Sans", sans-serif;
    margin: 0; color: #10202f; background: #fff; font-size: 13px;
  }
  .receipt {
    position: relative; width: 186mm; margin: 0 auto; padding: 8mm;
    border: 1.5px solid #123; border-radius: 6px;
  }
  header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #123; padding-bottom: 8px; }
  .logo, .logo-ph { width: 62px; height: 62px; flex: none; object-fit: contain; }
  .logo-ph { display: grid; place-items: center; border: 2px solid #1E86D6; border-radius: 50%;
             color: #1E86D6; font-weight: 800; font-size: 15px; }
  .head-text { flex: 1; }
  .head-text h1 { margin: 0; font-size: 19px; }
  .head-text .en { font-size: 10px; letter-spacing: .06em; color: #4a5b6b; }
  .head-text .sub { font-size: 11px; color: #4a5b6b; }
  .rcpt-no { text-align: center; border: 1.5px solid #123; border-radius: 6px; padding: 6px 10px; min-width: 46mm; }
  .rcpt-no span { display: block; font-size: 10px; color: #4a5b6b; }
  .rcpt-no b { font-size: 15px; letter-spacing: .03em; }
  .title { text-align: center; font-size: 16px; margin: 10px 0; padding: 4px; background: #eef5fb; border-radius: 4px; }
  .cols { display: flex; gap: 10px; }
  table { width: 100%; border-collapse: collapse; }
  .info th, .info td { border: 1px solid #ccd7e2; padding: 5px 7px; font-size: 12px; text-align: right; }
  .info th { background: #f4f8fc; width: 38%; font-weight: 600; color: #33475b; }
  .amount-box { margin: 10px 0; padding: 8px 12px; border: 2px solid #1E86D6; border-radius: 6px;
                display: flex; align-items: center; gap: 14px; background: #f4faff; }
  .amount-box .label { font-size: 12px; color: #33475b; }
  .amount-box .value { font-size: 22px; font-weight: 800; flex: 1; }
  .amount-box .method { font-size: 12px; }
  .alloc { margin-bottom: 8px; }
  .alloc th, .alloc td { border: 1px solid #ccd7e2; padding: 4px 7px; font-size: 12px; text-align: right; }
  .alloc thead th { background: #f4f8fc; }
  .totals th, .totals td { border: 1px solid #ccd7e2; padding: 5px 7px; font-size: 12px; text-align: right; }
  .totals th { background: #f4f8fc; width: 60%; font-weight: 600; }
  .totals .rest th, .totals .rest td { background: #fff7e6; font-size: 13px; }
  .num { text-align: left; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 800; }
  .notes { margin: 8px 0; font-size: 12px; }
  .signs { display: flex; gap: 14px; margin-top: 14px; }
  .signs > div { flex: 1; text-align: center; border-top: 1px dashed #8a9bab; padding-top: 6px; font-size: 11px; }
  .signs span { display: block; color: #4a5b6b; }
  .signs b { display: block; margin: 2px 0 12px; }
  .signs i { font-style: normal; color: #8a9bab; }
  .signs .stamp { border: 1px dashed #8a9bab; border-radius: 6px; min-height: 60px; padding-top: 6px; }
  footer { margin-top: 10px; text-align: center; font-size: 10.5px; color: #4a5b6b; }
  .reprint { position: absolute; top: 8mm; left: 8mm; font-size: 11px; color: #9B1F23;
             border: 1px solid #9B1F23; border-radius: 4px; padding: 2px 8px; }
  .void-stamp {
    position: absolute; inset: 0; display: grid; place-items: center;
    font-size: 74px; font-weight: 900; color: rgba(200, 30, 40, .18);
    transform: rotate(-18deg); pointer-events: none;
  }
  .is-void { border-color: #9B1F23; }
  @media print { .no-print { display: none !important; } body { background: #fff; } }
</style>
</head>
<body>
${Array.from({ length: Math.max(1, copies) }, () => body).join('<div style="page-break-after: always"></div>')}
</body>
</html>`;
}

export default renderReceiptHtml;
