import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, openPrint, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, dateTime, dateOnly } from '../lib/format.js';
import { Icon, Spinner, ErrorBox, Empty, Modal, Confirm, StatusBadge } from '../components/ui.jsx';
import InstallmentPay from '../components/InstallmentPay.jsx';
import { SplitBar } from '../components/charts.jsx';

const TABS = [['summary', 'الملخص المالي'], ['payments', 'الدفعات'], ['fees', 'الرسوم'], ['installments', 'الأقساط'], ['timeline', 'سجل النشاط']];

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('summary');
  const [timeline, setTimeline] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editingFees, setEditingFees] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.get(`/students/${id}`).then(setData).catch(setError);
    api.get(`/students/${id}/timeline`).then(setTimeline).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const s = data.student;
  const b = data.balance;

  const doVoid = async (reason) => {
    setBusy(true);
    try {
      const out = await api.post(`/payments/${voidTarget.id}/void`, { reason });
      toast.ok(out.message);
      setVoidTarget(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const doArchive = async () => {
    setBusy(true);
    try {
      const out = await api.post(`/students/${id}/archive`, { reason: 'أرشفة من ملف الطالب' });
      toast.ok(out.message);
      setArchiveOpen(false);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card-head">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/students')}><Icon name="back" size={16} />رجوع</button>
        <h1 style={{ margin: 0, flex: 1 }}>{s.full_name}</h1>
        {s.status === 'archived' && <StatusBadge status="archived" />}
        {can('payments.create') && s.status === 'active' && Number(b?.balance) > 0 && (
          <Link className="btn btn-ok" to={`/pay/${s.id}`}><Icon name="cash" size={16} />تسجيل دفعة</Link>
        )}
        {can('students.update') && <button className="btn btn-sm" onClick={() => setEditing(true)}><Icon name="edit" size={15} />تعديل</button>}
        {can('students.archive') && s.status === 'active' && (
          <button className="btn btn-sm" onClick={() => setArchiveOpen(true)}><Icon name="archive" size={15} />أرشفة</button>
        )}
      </div>

      <div className="grid g4">
        <Info label="رقم الطالب" value={s.student_number} mono />
        <Info label="الرقم الوطني" value={s.national_id} mono />
        <Info label="الصف / الفصل" value={[data.enrollment?.class_name, data.enrollment?.section_name].filter(Boolean).join(' - ') || '—'} />
        <Info label="السنة الدراسية" value={data.enrollment?.year_name || '—'} />
        <Info label="هاتف ولي الأمر" value={s.guardian_phone || '—'} mono />
        <Info label="هاتف إضافي" value={s.extra_phone || '—'} mono />
        <Info label="أضافه" value={`${timeline.find((t) => t.action === 'student_create')?.user_name || '—'}`} />
        <Info label="تاريخ الإضافة" value={dateTime(s.created_at)} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="grid g4" style={{ marginBottom: 12 }}>
          <Big label="إجمالي المستحق" value={money(b?.total_due)} />
          <Big label="المدفوع" value={money(b?.total_paid)} tone="ok" />
          <Big label="المتبقي" value={money(b?.balance)} tone={Number(b?.balance) > 0 ? 'bad' : 'ok'} />
          <div className="stat">
            <div className="label">حالة السداد</div>
            <div style={{ marginTop: 6 }}><StatusBadge status={b?.payment_status} /></div>
            {Number(b?.total_discount) > 0 && <div className="hint">خصم ممنوح: {money(b.total_discount)}</div>}
          </div>
        </div>
        <SplitBar paid={b?.total_paid} balance={b?.balance} />
      </div>

      <div className="tabs" style={{ marginTop: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="card">
          <h3>تفاصيل الرسوم</h3>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead><tr><th>البند</th><th>القيمة</th><th>الخصم</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
              <tbody>
                {data.fees.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.fee_name}</b>{!f.required && <span className="badge grey" style={{ marginInlineStart: 6 }}>غير مطلوب</span>}</td>
                    <td className="num">{money(f.amount, false)}</td>
                    <td className="num">{money(f.discount, false)}</td>
                    <td className="num">{money(f.net, false)}</td>
                    <td className="num">{money(f.paid, false)}</td>
                    <td className="num"><b>{f.required ? money(f.remaining, false) : '—'}</b></td>
                    <td>
                      <StatusBadge status={!f.required ? 'not_required'
                        : Number(f.remaining) <= 0 ? 'paid' : Number(f.paid) > 0 ? 'partial' : 'unpaid'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('fees.update') && (
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setEditingFees(true)}>
              <Icon name="edit" size={15} />تعديل الرسوم
            </button>
          )}
          {s.notes && <div className="alert info" style={{ marginTop: 12 }}><b>ملاحظات:</b> {s.notes}</div>}
        </div>
      )}

      {tab === 'payments' && (
        <div className="card">
          {data.payments.length === 0 && <Empty title="لا توجد دفعات" hint="سجّل أول دفعة من زر «تسجيل دفعة»." />}
          {data.payments.length > 0 && (
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="table">
                <thead><tr><th>الإيصال</th><th>التاريخ والوقت</th><th>المبلغ</th><th>الطريقة</th><th>الموظف</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="num">{p.receipt_number}</td>
                      <td className="num">{dateTime(p.paid_at)}</td>
                      <td className="num"><b>{money(p.amount, false)}</b></td>
                      <td>{p.method_name}</td>
                      <td className="hint">{p.created_by_name}</td>
                      <td>
                        <StatusBadge status={p.status} />
                        {p.status === 'void' && <div className="hint">{p.void_reason}</div>}
                      </td>
                      <td className="actions">
                        {can('receipts.print') && (
                          <>
                            <button className="btn btn-sm" onClick={() => openReceipt(p.id)}><Icon name="print" size={14} />طباعة</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => pdfReceipt(p.id, p.receipt_number, toast)}>PDF</button>
                          </>
                        )}
                        {can('payments.void') && p.status === 'active' && (
                          <button className="btn btn-sm btn-danger" onClick={() => setVoidTarget(p)}>إلغاء</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'fees' && (
        <div className="card">
          <h3>سجل تعديل الرسوم</h3>
          <p className="hint">كل تعديل على الرسوم أو خصم يُسجَّل بسببه ومنفّذه في سجل العمليات.</p>
          <div className="rows">
            {timeline.filter((t) => ['fee_update', 'discount_grant'].includes(t.action)).map((t) => (
              <div key={t.id} className="row">
                <span className="name">{t.description}</span>
                <span className="hint">{t.user_name} · {dateTime(t.created_at)}</span>
              </div>
            ))}
            {timeline.filter((t) => ['fee_update', 'discount_grant'].includes(t.action)).length === 0 && (
              <p className="hint">لا توجد تعديلات على الرسوم.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'installments' && (
        <Installments studentId={id} items={data.installments} onChange={load} can={can} toast={toast} />
      )}

      {tab === 'timeline' && (
        <div className="card">
          <h3>سجل نشاط الطالب</h3>
          {timeline.length === 0 && <p className="hint">لا يوجد نشاط.</p>}
          <div className="rows">
            {timeline.map((t) => (
              <div key={t.id} className="row">
                <span className="num hint" style={{ minWidth: 128 }}>{dateTime(t.created_at)}</span>
                <span className="name">{t.description}</span>
                <span className="badge grey">{t.user_name || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && <EditStudent student={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} can={can} toast={toast} />}
      {editingFees && <EditFees studentId={id} fees={data.fees} hasPayments={Number(b?.total_paid) > 0}
        onClose={() => setEditingFees(false)} onSaved={() => { setEditingFees(false); load(); }} toast={toast} />}
      {voidTarget && <VoidPayment payment={voidTarget} busy={busy} onClose={() => setVoidTarget(null)} onConfirm={doVoid} />}
      {archiveOpen && (
        <Confirm title="أرشفة الطالب" danger busy={busy}
          message="سيُنقل الطالب إلى الأرشيف ولن يظهر في القوائم النشطة. لن يُحذف أي شيء: بياناته ودفعاته وإيصالاته تبقى محفوظة."
          confirmText="أرشفة" onConfirm={doArchive} onClose={() => setArchiveOpen(false)} />
      )}
    </div>
  );
}

async function openReceipt(paymentId) {
  const p = await api.get(`/payments/${paymentId}`);
  await openPrint(`/receipts/${p.receipt_id}/print`);
}

async function pdfReceipt(paymentId, number, toast) {
  try {
    const p = await api.get(`/payments/${paymentId}`);
    await download(`/receipts/${p.receipt_id}/pdf`, `${number}.pdf`);
  } catch (err) { toast.error(err.message); }
}

const Info = ({ label, value, mono }) => (
  <div className="stat">
    <div className="label">{label}</div>
    <div style={{ fontWeight: 700, marginTop: 2 }} className={mono ? 'num' : ''}>{value}</div>
  </div>
);

const Big = ({ label, value, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="label">{label}</div>
    <div className="value num">{value}</div>
  </div>
);

/* ---------------- تعديل بيانات الطالب ---------------- */

function EditStudent({ student, onClose, onSaved, can, toast }) {
  const [form, setForm] = useState({
    full_name: student.full_name, guardian_phone: student.guardian_phone || '',
    extra_phone: student.extra_phone || '', notes: student.notes || '',
    national_id: student.national_id, reason: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idChanged = form.national_id !== student.national_id;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.patch(`/students/${student.id}`, form);
      toast.ok('تم حفظ التعديلات.');
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="تعديل بيانات الطالب" onClose={onClose} actions={
      <>
        <button className="btn btn-primary" onClick={save} disabled={busy || (idChanged && form.reason.trim().length < 3)}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      {error && <div className="alert bad">{error}</div>}
      <div className="field"><label>اسم الطالب</label><input className="input" value={form.full_name} onChange={set('full_name')} /></div>
      <div className="grid g2">
        <div className="field"><label>هاتف ولي الأمر</label><input className="input ltr" value={form.guardian_phone} onChange={set('guardian_phone')} /></div>
        <div className="field"><label>هاتف إضافي</label><input className="input ltr" value={form.extra_phone} onChange={set('extra_phone')} /></div>
      </div>
      <div className="field">
        <label>الرقم الوطني</label>
        <input className="input ltr" value={form.national_id} onChange={set('national_id')}
          disabled={!can('students.change_national_id')} />
        {!can('students.change_national_id') && <div className="hint">تغيير الرقم الوطني يحتاج صلاحية خاصة.</div>}
      </div>
      {idChanged && (
        <>
          <div className="alert warn">أنت على وشك تغيير الرقم الوطني. ستُسجَّل العملية باسمك مع القيمة القديمة والجديدة.</div>
          <div className="field"><label>سبب التغيير <span className="req">*</span></label>
            <input className="input" value={form.reason} onChange={set('reason')} placeholder="مثال: تصحيح خطأ إملائي من شهادة الميلاد" /></div>
        </>
      )}
      <div className="field"><label>ملاحظات</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
    </Modal>
  );
}

/* ---------------- تعديل الرسوم ---------------- */

function EditFees({ studentId, fees, hasPayments, onClose, onSaved, toast }) {
  const [rows, setRows] = useState(fees.map((f) => ({
    fee_type_id: f.fee_type_id, fee_name: f.fee_name, amount: f.amount, discount: f.discount, required: f.required
  })));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (i, key, value) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.put(`/students/${studentId}/fees`, { fees: rows, reason });
      toast.ok('تم تحديث الرسوم وأُعيد حساب الحساب المالي.');
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="تعديل الرسوم" wide onClose={onClose} actions={
      <>
        <button className="btn btn-primary" disabled={busy || (hasPayments && reason.trim().length < 3)} onClick={save}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الرسوم'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      {error && <div className="alert bad">{error}</div>}
      {hasPayments && (
        <div className="alert warn">
          هذا الطالب لديه دفعات مسجلة. تعديل الرسوم سيعيد حساب المتبقي، ويجب كتابة سبب التعديل وسيُحفظ باسمك.
        </div>
      )}
      <div className="table-wrap" style={{ border: 'none' }}>
        <table className="table">
          <thead><tr><th>البند</th><th>القيمة</th><th>الخصم</th><th>مطلوب؟</th></tr></thead>
          <tbody>
            {rows.map((f, i) => (
              <tr key={f.fee_type_id}>
                <td><b>{f.fee_name}</b></td>
                <td><input className="input ltr" style={{ width: 120 }} value={f.amount} onChange={(e) => update(i, 'amount', e.target.value)} /></td>
                <td><input className="input ltr" style={{ width: 120 }} value={f.discount} onChange={(e) => update(i, 'discount', e.target.value)} /></td>
                <td>
                  <input type="checkbox" checked={!!f.required} onChange={(e) => update(i, 'required', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>سبب التعديل {hasPayments && <span className="req">*</span>}</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: خصم أخوة معتمد من الإدارة" />
      </div>
    </Modal>
  );
}

/* ---------------- إلغاء دفعة ---------------- */

function VoidPayment({ payment, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`إلغاء الدفعة ${payment.receipt_number}`} onClose={onClose} actions={
      <>
        <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason)}>
          {busy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>تراجع</button>
      </>
    }>
      <div className="alert bad">
        لن تُحذف الدفعة — ستُعلَّم «ملغاة» ولن تدخل في أي مجموع، وسيصبح الإيصال ملغيًا،
        وسيُعاد حساب رصيد الطالب تلقائيًا. ستُسجَّل العملية باسمك مع السبب والوقت.
      </div>
      <div className="kv" style={{ marginBottom: 12 }}>
        <dt>المبلغ</dt><dd className="num">{money(payment.amount)}</dd>
        <dt>التاريخ</dt><dd className="num">{dateTime(payment.paid_at)}</dd>
      </div>
      <div className="field">
        <label>سبب الإلغاء <span className="req">*</span></label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
          placeholder="مثال: خطأ في المبلغ المدخل" />
      </div>
    </Modal>
  );
}

/* ---------------- أقساط الطالب ---------------- */

function Installments({ studentId, items, onChange, can, toast }) {
  const [form, setForm] = useState({ name_ar: '', amount: '', due_date: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(null);
  const [editing, setEditing] = useState(null);
  const [logOf, setLogOf] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/students/${studentId}/installments`, form);
      toast.ok('تمت إضافة القسط.');
      setForm({ name_ar: '', amount: '', due_date: '', notes: '' });
      setAdding(false);
      onChange();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async (instId) => {
    try {
      await api.del(`/students/${studentId}/installments/${instId}`);
      toast.ok('تم حذف القسط.');
      onChange();
    } catch (err) { toast.error(err.message); }
  };

  const totals = items.reduce((t, i) => ({
    amount: t.amount + Math.round(Number(i.amount) * 100),
    paid: t.paid + Math.round(Number(i.paid) * 100),
    remaining: t.remaining + Math.round(Number(i.remaining) * 100)
  }), { amount: 0, paid: 0, remaining: 0 });

  return (
    <div className="card">
      <div className="card-head">
        <h3 style={{ margin: 0 }}>الأقساط</h3>
        {items.length > 0 && (
          <span className="hint num">
            {money((totals.paid / 100).toFixed(2))} من {money((totals.amount / 100).toFixed(2))}
            {' '}· المتبقي {money((totals.remaining / 100).toFixed(2))}
          </span>
        )}
        {can('installments.manage') && (
          <button className="btn btn-sm btn-primary" onClick={() => setAdding((x) => !x)}>
            <Icon name="plus" size={15} />إضافة قسط
          </button>
        )}
      </div>

      {adding && can('installments.manage') && (
        <form className="card" style={{ background: '#F7FAFD', marginBottom: 12 }} onSubmit={add}>
          <div className="grid g2">
            <div className="field">
              <label>اسم القسط <span className="req">*</span></label>
              <input className="input" value={form.name_ar} required
                placeholder="القسط الأول · سبتمبر · الدفعة الأخيرة…"
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
              <div className="hint">اكتب أي اسم يناسبك.</div>
            </div>
            <div className="field">
              <label>قيمة القسط <span className="req">*</span></label>
              <input className="input ltr" value={form.amount} required inputMode="decimal" placeholder="0.00"
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>تاريخ الاستحقاق</label>
              <input className="input" type="date" value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div className="field">
              <label>ملاحظات</label>
              <input className="input" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            <Icon name="check" size={16} />{busy ? 'جارٍ الحفظ…' : 'حفظ القسط'}
          </button>
        </form>
      )}

      {items.length === 0 && (
        <Empty title="لا توجد أقساط"
          hint="الأقساط اختيارية — أضف قسطًا لتقسيم المستحق على دفعات بتواريخ، والنظام يعمل بدونها." />
      )}

      <div className="inst-list">
        {items.map((i) => {
          const id = i.installment_id || i.id;
          const done = Number(i.remaining) <= 0;
          return (
            <div key={id} className={`inst ${i.status}`}>
              <div className="inst-head">
                <div style={{ minWidth: 0 }}>
                  <b>{i.name_ar}</b>
                  <div className="hint">
                    {i.due_date ? `يستحق ${dateOnly(i.due_date)}` : 'بلا تاريخ استحقاق'}
                    {i.payments_count ? ` · ${i.payments_count} دفعة` : ''}
                    {i.notes ? ` · ${i.notes}` : ''}
                  </div>
                </div>
                <StatusBadge status={i.status} />
              </div>

              <div className="inst-nums">
                <span><small>قيمة القسط</small><b className="num">{money(i.amount, false)}</b></span>
                <span><small>المدفوع</small><b className="num" style={{ color: 'var(--ok)' }}>{money(i.paid, false)}</b></span>
                <span><small>المتبقي</small><b className="num" style={{ color: done ? 'var(--ok)' : 'var(--bad)' }}>
                  {money(i.remaining, false)}</b></span>
              </div>

              <div className="inst-bar">
                <div className="bar-mini"><i style={{ width: `${i.percent ?? 0}%` }} /></div>
                <span className="num hint">{i.percent ?? 0}%</span>
              </div>

              <div className="inst-actions">
                {can('payments.create') && !done && (
                  <button className="btn btn-sm btn-ok" onClick={() => setPaying(id)}>
                    <Icon name="cash" size={14} />تسجيل دفعة
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setLogOf(id)}>
                  <Icon name="list" size={14} />سجل الدفعات
                </button>
                {can('installments.manage') && (
                  <button className="btn btn-sm" onClick={() => setEditing(i)}>
                    <Icon name="edit" size={14} />تعديل
                  </button>
                )}
                {can('installments.manage') && Number(i.paid) === 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(id)}>حذف</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          «المدفوع» ليس حقلًا يُكتب — يزيد فقط بتسجيل دفعة لها إيصال ومنفّذ ووقت.
          ولتصحيح دفعة خاطئة استخدم «إلغاء الدفعة» لا تعديل الرقم.
        </p>
      )}

      {paying && (
        <InstallmentPay installmentId={paying} onClose={() => setPaying(null)}
          onDone={(out) => { setPaying(null); toast.ok(out.message); onChange(); }} />
      )}

      {editing && (
        <EditInstallment studentId={studentId} inst={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); toast.ok('تم حفظ تعديل القسط.'); }} />
      )}

      {logOf && (
        <InstallmentLog studentId={studentId} installmentId={logOf} onClose={() => setLogOf(null)} />
      )}
    </div>
  );
}

/* ---------------- تعديل قسط ---------------- */

function EditInstallment({ studentId, inst, onClose, onSaved }) {
  const id = inst.installment_id || inst.id;
  const [form, setForm] = useState({
    name_ar: inst.name_ar,
    amount: String(inst.amount),
    due_date: inst.due_date ? String(inst.due_date).slice(0, 10) : '',
    notes: inst.notes || '',
    reason: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const paid = Number(inst.paid);
  const below = Number(form.amount) < paid;

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.patch(`/students/${studentId}/installments/${id}`, form);
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={`تعديل: ${inst.name_ar}`} onClose={onClose} actions={
      <>
        <button className="btn btn-primary" onClick={save} disabled={busy || below}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      {error && <div className="alert bad">{error}</div>}
      {paid > 0 && (
        <div className="alert warn">
          هذا القسط دُفع عليه <b className="num">{money(paid)}</b> — لا يمكن جعل قيمته أقل من هذا المبلغ،
          وسيُسجَّل التعديل بالقيمة القديمة والجديدة باسمك.
        </div>
      )}
      <div className="grid g2">
        <div className="field">
          <label>اسم القسط</label>
          <input className="input" value={form.name_ar} onChange={set('name_ar')} />
        </div>
        <div className="field">
          <label>قيمة القسط</label>
          <input className="input ltr" value={form.amount} onChange={set('amount')} inputMode="decimal" />
          {below && <div className="error-text">لا يمكن جعل قيمة القسط أقل من المبلغ المدفوع عليه ({money(paid)}).</div>}
        </div>
        <div className="field">
          <label>تاريخ الاستحقاق</label>
          <input className="input" type="date" value={form.due_date} onChange={set('due_date')} />
        </div>
        <div className="field">
          <label>ملاحظات</label>
          <input className="input" value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      <div className="field">
        <label>سبب التعديل</label>
        <input className="input" value={form.reason} onChange={set('reason')} placeholder="مثال: اتفاق جديد مع ولي الأمر" />
      </div>
    </Modal>
  );
}

/* ---------------- سجل دفعات القسط ---------------- */

function InstallmentLog({ studentId, installmentId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/students/${studentId}/installments/${installmentId}/payments`)
      .then(setData).catch((err) => setError(err.message));
  }, [studentId, installmentId]);

  return (
    <Modal title="سجل دفعات القسط" wide onClose={onClose}>
      {error && <div className="alert bad">{error}</div>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div className="kv" style={{ marginBottom: 12 }}>
            <dt>القسط</dt><dd>{data.installment.name_ar}</dd>
            <dt>قيمة القسط</dt><dd className="num">{money(data.installment.amount)}</dd>
            <dt>المدفوع</dt><dd className="num">{money(data.installment.paid)}</dd>
            <dt>المتبقي</dt><dd className="num"><b>{money(data.installment.remaining)}</b></dd>
          </div>

          {data.payments.length === 0
            ? <Empty title="لا توجد دفعات على هذا القسط بعد" />
            : (
              <div className="table-wrap" style={{ border: 'none' }}>
                <table className="table">
                  <thead><tr><th>التاريخ</th><th>المبلغ</th><th>طريقة الدفع</th><th>الموظف</th><th>الإيصال</th><th>الحالة</th><th></th></tr></thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num">{dateTime(p.paid_at)}</td>
                        <td className="num"><b>{money(p.amount, false)}</b></td>
                        <td>{p.method_name}</td>
                        <td className="hint">{p.cashier}</td>
                        <td className="num">{p.receipt_number}</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td>
                          {p.receipt_id && (
                            <button className="btn btn-sm btn-ghost" onClick={() => openPrint(`/receipts/${p.receipt_id}/print`)}>
                              <Icon name="print" size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td><b>الإجمالي</b></td>
                      <td className="num"><b>{money(data.installment.paid, false)}</b></td>
                      <td colSpan={5} className="hint">المتبقي: {money(data.installment.remaining)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

          {data.changes.length > 0 && (
            <>
              <h4 style={{ marginTop: 14 }}>سجل تعديلات القسط</h4>
              <div className="rows">
                {data.changes.map((c) => (
                  <div key={c.id} className="row">
                    <span className="name">
                      {c.old_amount !== c.new_amount
                        ? `القيمة: ${money(c.old_amount, false)} ← ${money(c.new_amount, false)}`
                        : `الاسم: ${c.old_name} ← ${c.new_name}`}
                      {c.reason ? ` — ${c.reason}` : ''}
                    </span>
                    <span className="hint">{c.changed_by_name} · {dateTime(c.changed_at)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
