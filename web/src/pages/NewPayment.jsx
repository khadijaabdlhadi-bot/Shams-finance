import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, openPrint, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money } from '../lib/format.js';
import { Icon, Spinner, SearchBox, Empty, StatusBadge } from '../components/ui.jsx';

/**
 * شاشة تسجيل الدفعة: ابحث عن الطالب ← راجع أرقامه ← اكتب المبلغ ← تأكيد.
 * الأرقام كلها من الخادم، والمتبقي الجديد يُعرض قبل الضغط على «تأكيد».
 */
export default function NewPayment() {
  const { studentId } = useParams();
  const [selected, setSelected] = useState(studentId || null);

  useEffect(() => { setSelected(studentId || null); }, [studentId]);

  return selected
    ? <PaymentForm studentId={selected} onBack={() => setSelected(null)} />
    : <StudentPicker onPick={setSelected} />;
}

function StudentPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ size: '15', payment_status: 'all' });
    if (q) qs.set('q', q);
    api.get(`/students?${qs}`).then((d) => setRows(d.rows)).catch(() => setRows([])).finally(() => setLoading(false));
  }, [q]);

  return (
    <div>
      <h1>تسجيل دفعة</h1>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="ابحث عن الطالب بالرقم الوطني أو الاسم أو رقم الطالب…" />
        </div>
        {loading && <Spinner />}
        {!loading && rows.length === 0 && <Empty title="لا يوجد طالب مطابق" hint="اكتب جزءًا من الاسم أو الرقم الوطني." />}
        {!loading && rows.length > 0 && (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead><tr><th>رقم الطالب</th><th>الرقم الوطني</th><th>الاسم</th><th>الصف</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => onPick(String(s.id))}>
                    <td className="num">{s.student_number}</td>
                    <td className="num">{s.national_id}</td>
                    <td><b>{s.full_name}</b></td>
                    <td>{[s.class_name, s.section_name].filter(Boolean).join(' - ') || '—'}</td>
                    <td className="num"><b>{money(s.balance, false)}</b></td>
                    <td><StatusBadge status={s.payment_status} /></td>
                    <td><button className="btn btn-sm btn-ok">اختيار</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentForm({ studentId, onBack }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get(`/payments/prepare/${studentId}`)
      .then((d) => { setData(d); setMethodId(String(d.methods[0]?.id || '')); })
      .catch((err) => setError(err.message));
  }, [studentId]);

  if (error && !data) return <div className="alert bad">{error}</div>;
  if (!data) return <Spinner />;

  const remaining = Number(data.balance?.balance || 0);
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const after = Math.max(0, Math.round((remaining - value) * 100) / 100);
  const valid = value > 0 && value <= remaining;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    try {
      const out = await api.post('/payments', {
        student_id: Number(studentId), amount: String(value), method_id: Number(methodId), notes
      });
      setDone(out);
      toast.ok(out.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div>
        <div className="card" style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: '2.4rem' }}>✅</div>
          <h2>تم تسجيل الدفعة بنجاح</h2>
          <p>رقم الإيصال: <b className="num">{done.receipt_number}</b></p>
          <div className="kv" style={{ maxWidth: 340, margin: '14px auto', textAlign: 'start' }}>
            <dt>قيمة الدفعة</dt><dd className="num">{money(done.snapshot.balances.this_payment)}</dd>
            <dt>إجمالي المدفوع</dt><dd className="num">{money(done.snapshot.balances.paid_after)}</dd>
            <dt>المتبقي</dt><dd className="num">{money(done.snapshot.balances.remaining_after)}</dd>
          </div>
          <div className="toolbar" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => openPrint(`/receipts/${done.receipt_id}/print`)}>
              <Icon name="print" size={16} />طباعة الإيصال
            </button>
            <button className="btn" onClick={() => download(`/receipts/${done.receipt_id}/pdf`, `${done.receipt_number}.pdf`).catch((e) => toast.error(e.message))}>
              <Icon name="download" size={16} />تنزيل PDF
            </button>
            <button className="btn" onClick={() => navigate(`/students/${studentId}`)}>العودة لحساب الطالب</button>
            <button className="btn btn-ghost" onClick={() => { setDone(null); setAmount(''); setNotes(''); onBack(); }}>دفعة أخرى</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="back" size={16} />تغيير الطالب</button>
        <h1 style={{ margin: 0 }}>تسجيل دفعة</h1>
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>بيانات الطالب</h3>
          <div className="kv">
            <dt>الاسم</dt><dd>{data.student.full_name}</dd>
            <dt>الرقم الوطني</dt><dd className="num">{data.student.national_id}</dd>
            <dt>رقم الطالب</dt><dd className="num">{data.student.student_number}</dd>
            <dt>الصف / الفصل</dt><dd>{[data.enrollment.class_name, data.enrollment.section_name].filter(Boolean).join(' - ') || '—'}</dd>
            <dt>السنة الدراسية</dt><dd>{data.enrollment.year_name}</dd>
          </div>

          <div className="table-wrap" style={{ border: 'none', marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>البند</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
              <tbody>
                {data.fees.filter((f) => f.required).map((f) => (
                  <tr key={f.id}>
                    <td>{f.fee_name}</td>
                    <td className="num">{money(f.net, false)}</td>
                    <td className="num">{money(f.paid, false)}</td>
                    <td className="num"><b>{money(f.remaining, false)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            تُوزَّع الدفعة تلقائيًا على البنود بالترتيب حتى ينتهي المبلغ.
          </p>
        </div>

        <form className="card" onSubmit={submit}>
          <h3>تفاصيل الدفعة</h3>
          <div className="kv" style={{ marginBottom: 12 }}>
            <dt>إجمالي المستحق</dt><dd className="num">{money(data.balance.total_due)}</dd>
            <dt>المدفوع سابقًا</dt><dd className="num">{money(data.balance.total_paid)}</dd>
            <dt>المتبقي قبل الدفع</dt><dd className="num"><b>{money(data.balance.balance)}</b></dd>
          </div>

          {remaining <= 0 && <div className="alert ok">هذا الطالب سدّد كامل المستحق. لا حاجة لدفعة جديدة.</div>}

          <div className="field">
            <label>قيمة الدفعة <span className="req">*</span></label>
            <input className="input ltr" value={amount} onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal" placeholder="0.00" autoFocus disabled={remaining <= 0} />
            {amount && !valid && (
              <div className="error-text">
                {value <= 0 ? 'المبلغ يجب أن يكون أكبر من صفر.' : `المبلغ أكبر من المتبقي (${money(remaining)}).`}
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm" disabled={remaining <= 0}
                onClick={() => setAmount(String(remaining.toFixed(2)))}>سداد كامل المتبقي</button>
            </div>
          </div>

          <div className="field">
            <label>طريقة الدفع <span className="req">*</span></label>
            <select className="select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {data.methods.map((m) => <option key={m.id} value={m.id}>{m.name_ar}</option>)}
            </select>
          </div>

          <div className="field">
            <label>ملاحظات</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>

          {valid && (
            <div className="alert info">
              <div className="kv">
                <dt>المتبقي قبل الدفعة</dt><dd className="num">{money(remaining)}</dd>
                <dt>قيمة الدفعة</dt><dd className="num">{money(value.toFixed(2))}</dd>
                <dt>المتبقي بعد العملية</dt><dd className="num"><b>{money(after.toFixed(2))}</b></dd>
              </div>
            </div>
          )}

          {error && <div className="alert bad">{error}</div>}

          <button className="btn btn-ok btn-block btn-lg" disabled={!valid || busy}>
            {busy ? 'جارٍ التسجيل…' : <><Icon name="check" size={17} />تأكيد وتسجيل الدفعة</>}
          </button>
          <p className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
            سيُنشأ الإيصال تلقائيًا باسمك وبتوقيت الخادم.
          </p>
        </form>
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        <Link to={`/students/${studentId}`}>فتح ملف الطالب الكامل</Link>
      </p>
    </div>
  );
}
