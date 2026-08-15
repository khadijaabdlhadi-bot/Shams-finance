import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num } from '../lib/format.js';
import { Icon, Spinner, ErrorBox } from '../components/ui.jsx';

/** طرق الدفع — الافتراضية ثلاث، والمدير يضيف أو يعطّل. */
export default function PaymentMethods() {
  const { can, toast } = useApp();
  const [methods, setMethods] = useState(null);
  const [stats, setStats] = useState([]);
  const [form, setForm] = useState({ code: '', name_ar: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    api.get('/settings/payment-methods').then(setMethods).catch(setError);
    api.get('/finance/treasury').then((d) => setStats(d.by_method)).catch(() => {});
  };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!methods) return <Spinner />;

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/settings/payment-methods', form);
      setForm({ code: '', name_ar: '' });
      toast.ok('تمت إضافة طريقة الدفع.');
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggle = async (m) => {
    try {
      await api.patch(`/settings/payment-methods/${m.id}`, { active: !m.active });
      toast.ok(m.active ? 'تم تعطيل الطريقة.' : 'تم تفعيل الطريقة.');
      load();
    } catch (err) { toast.error(err.message); }
  };

  const statOf = (code) => stats.find((s) => s.code === code) || { value: '0.00', today: '0.00', count: 0 };

  return (
    <div>
      <h1>طرق الدفع</h1>

      <div className="grid g3">
        {methods.map((m) => {
          const s = statOf(m.code);
          return (
            <div className="card" key={m.id}>
              <div className="card-head">
                <h3 style={{ margin: 0 }}>{m.name_ar}</h3>
                <span className={`badge ${m.active ? 'ok' : 'grey'}`}>{m.active ? 'مفعّلة' : 'معطّلة'}</span>
              </div>
              <div className="kv">
                <dt>الرمز</dt><dd className="num">{m.code}</dd>
                <dt>تحصيل اليوم</dt><dd className="num">{money(s.today)}</dd>
                <dt>الإجمالي</dt><dd className="num">{money(s.value)}</dd>
                <dt>عدد العمليات</dt><dd className="num">{num(s.count)}</dd>
              </div>
              {can('settings.manage') && (
                <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => toggle(m)}>
                  {m.active ? 'تعطيل' : 'تفعيل'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {can('settings.manage') && (
        <form className="card" style={{ marginTop: 14 }} onSubmit={add}>
          <h3>إضافة طريقة دفع</h3>
          <div className="grid g3">
            <div className="field">
              <label>الرمز (إنجليزي) <span className="req">*</span></label>
              <input className="input ltr" value={form.code} placeholder="cheque"
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            </div>
            <div className="field">
              <label>الاسم بالعربية <span className="req">*</span></label>
              <input className="input" value={form.name_ar} placeholder="شيك"
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))} required />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy || !form.code || !form.name_ar}>
                <Icon name="plus" size={16} />إضافة
              </button>
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            تعطيل طريقة دفع يمنع استخدامها في الدفعات الجديدة فقط — الدفعات القديمة تبقى كما هي بتقاريرها.
          </p>
        </form>
      )}
    </div>
  );
}
