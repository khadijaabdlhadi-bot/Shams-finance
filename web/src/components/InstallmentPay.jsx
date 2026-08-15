import { useEffect, useState } from 'react';
import { api, openPrint, download } from '../lib/api.js';
import { money, dateOnly } from '../lib/format.js';
import { Icon, Modal, Spinner } from './ui.jsx';

/**
 * تسجيل دفعة على قسط بعينه — مع معاينة كاملة قبل التأكيد:
 * قيمة القسط · المدفوع سابقًا · الدفعة الحالية · إجمالي المدفوع بعدها · المتبقي بعدها.
 * كل الأرقام تأتي من الخادم، والتحقق النهائي يتم فيه أيضًا.
 */
export default function InstallmentPay({ installmentId, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get(`/payments/prepare-installment/${installmentId}`)
      .then((d) => { setData(d); setMethodId(String(d.methods[0]?.id || '')); })
      .catch((err) => setError(err.message));
  }, [installmentId]);

  if (error && !data) {
    return <Modal title="تسجيل دفعة على قسط" onClose={onClose}><div className="alert bad">{error}</div></Modal>;
  }
  if (!data) return <Modal title="تسجيل دفعة على قسط" onClose={onClose}><Spinner /></Modal>;

  const inst = data.installment;
  const remaining = Number(inst.remaining);
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const valid = value > 0 && value <= remaining;
  const paidAfter = Math.round((Number(inst.paid) + value) * 100) / 100;
  const remainingAfter = Math.round((remaining - value) * 100) / 100;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setError('');
    try {
      const out = await api.post('/payments', {
        student_id: inst.student_id,
        installment_id: installmentId,
        amount: String(value),
        method_id: Number(methodId),
        notes
      });
      setDone(out);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal title="تمت العملية" onClose={() => onDone(done)} actions={
        <>
          <button className="btn btn-primary" onClick={() => openPrint(`/receipts/${done.receipt_id}/print`)}>
            <Icon name="print" size={16} />طباعة الإيصال
          </button>
          <button className="btn" onClick={() => download(`/receipts/${done.receipt_id}/pdf`, `${done.receipt_number}.pdf`).catch(() => {})}>
            <Icon name="download" size={16} />PDF
          </button>
          <button className="btn btn-ghost" onClick={() => onDone(done)}>إغلاق</button>
        </>
      }>
        <div className="alert ok">{done.message}</div>
        <div className="kv">
          <dt>القسط</dt><dd>{done.snapshot.installment?.name}</dd>
          <dt>الدفعة</dt><dd className="num">{money(done.snapshot.installment?.this_payment)}</dd>
          <dt>إجمالي المدفوع من القسط</dt><dd className="num">{money(done.snapshot.installment?.paid_after)}</dd>
          <dt>المتبقي من القسط</dt><dd className="num"><b>{money(done.snapshot.installment?.remaining_after)}</b></dd>
          <dt>المتبقي على الطالب</dt><dd className="num">{money(done.snapshot.balances?.remaining_after)}</dd>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`تسجيل دفعة — ${inst.name_ar}`} onClose={onClose} actions={
      <>
        <button className="btn btn-ok" disabled={!valid || busy} onClick={submit}>
          {busy ? 'جارٍ التسجيل…' : <><Icon name="check" size={16} />تأكيد الدفع</>}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      <div className="kv" style={{ marginBottom: 12 }}>
        <dt>الطالب</dt><dd>{inst.full_name}</dd>
        <dt>الرقم الوطني</dt><dd className="num">{inst.national_id}</dd>
        <dt>القسط</dt><dd>{inst.name_ar}{inst.due_date ? ` · يستحق ${dateOnly(inst.due_date)}` : ''}</dd>
        <dt>قيمة القسط</dt><dd className="num">{money(inst.amount)}</dd>
        <dt>المدفوع سابقًا</dt><dd className="num">{money(inst.paid)}</dd>
        <dt>المتبقي</dt><dd className="num"><b>{money(inst.remaining)}</b></dd>
      </div>

      {remaining <= 0 && <div className="alert ok">هذا القسط مدفوع بالكامل.</div>}

      <div className="grid g2">
        <div className="field">
          <label>قيمة الدفعة <span className="req">*</span></label>
          <input className="input ltr" value={amount} onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal" placeholder="0.00" autoFocus disabled={remaining <= 0} />
          {amount && !valid && (
            <div className="error-text">
              {value <= 0 ? 'المبلغ يجب أن يكون أكبر من صفر.' : `المبلغ أكبر من المتبقي على القسط (${money(remaining)}).`}
            </div>
          )}
          <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} disabled={remaining <= 0}
            onClick={() => setAmount(String(remaining.toFixed(2)))}>سداد كامل القسط</button>
        </div>
        <div className="field">
          <label>طريقة الدفع <span className="req">*</span></label>
          <select className="select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            {data.methods.map((m) => <option key={m.id} value={m.id}>{m.name_ar}</option>)}
          </select>
          <label style={{ marginTop: 10 }}>ملاحظات</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      {valid && (
        <div className="alert info">
          <div className="kv">
            <dt>قيمة القسط</dt><dd className="num">{money(inst.amount)}</dd>
            <dt>المدفوع سابقًا</dt><dd className="num">{money(inst.paid)}</dd>
            <dt>الدفعة الحالية</dt><dd className="num">{money(value.toFixed(2))}</dd>
            <dt>إجمالي المدفوع بعد العملية</dt><dd className="num">{money(paidAfter.toFixed(2))}</dd>
            <dt>المتبقي بعد العملية</dt><dd className="num"><b>{money(remainingAfter.toFixed(2))}</b></dd>
          </div>
        </div>
      )}

      {error && <div className="alert bad">{error}</div>}
      <p className="hint" style={{ marginBottom: 0 }}>
        سيُنشأ إيصال مستقل لهذه الدفعة باسمك وبتوقيت الخادم، وتُسجَّل العملية في سجل العمليات.
      </p>
    </Modal>
  );
}
