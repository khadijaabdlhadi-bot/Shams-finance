import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money, num, dateTime } from '../lib/format.js';
import { Icon, Spinner, ErrorBox, Empty } from '../components/ui.jsx';
import { LabeledBars } from '../components/charts.jsx';

/** الخزينة — ما دخل فعليًا، وبأي طريقة، وعلى يد من. */
export default function Treasury() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  const load = () => { setError(null); api.get('/finance/treasury').then(setD).catch(setError); };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d) return <Spinner />;

  const net = (Number(d.balance.total) || 0).toFixed(2);

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>الخزينة</h1>
        <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={15} />تحديث</button>
      </div>

      <div className="grid g4">
        <Box label="رصيد الخزينة" value={money(d.balance.total)} hint={`${num(d.balance.count)} دفعة سارية`} tone="ok" icon="cash" />
        <Box label="مقبوضات اليوم" value={money(d.today.total)} hint={`${num(d.today.count)} عملية`} icon="chart" />
        <Box label="مقبوضات الشهر" value={money(d.month.total)} hint={`${num(d.month.count)} عملية`} />
        <Box label="دفعات ملغاة" value={money(d.voided.total)} hint={`${num(d.voided.count)} عملية — خارج الرصيد`} tone="bad" icon="warn" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>حسب طريقة الدفع</h3>
          <LabeledBars data={d.by_method.map((m) => ({ label: m.label, value: m.value, count: m.count }))} />
          <div className="table-wrap" style={{ border: 'none', marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>الطريقة</th><th>اليوم</th><th>الإجمالي</th><th>العمليات</th></tr></thead>
              <tbody>
                {d.by_method.map((m) => (
                  <tr key={m.code}>
                    <td><b>{m.label}</b></td>
                    <td className="num">{money(m.today, false)}</td>
                    <td className="num">{money(m.value, false)}</td>
                    <td className="num">{num(m.count)}</td>
                  </tr>
                ))}
                <tr>
                  <td><b>صافي الحركة</b></td>
                  <td className="num"><b>{money(d.today.total, false)}</b></td>
                  <td className="num"><b>{money(net, false)}</b></td>
                  <td className="num">{num(d.balance.count)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>تحصيلات اليوم حسب الموظف</h3>
          {d.by_user.length === 0 && <Empty title="لا توجد تحصيلات اليوم" hint="ستظهر هنا فور تسجيل أول دفعة اليوم." />}
          {d.by_user.length > 0 && (
            <div className="rows">
              {d.by_user.map((u) => (
                <div key={u.label} className="row">
                  <span className="name">{u.label}</span>
                  <span className="hint">{num(u.count)} عملية</span>
                  <b className="num">{money(u.today)}</b>
                </div>
              ))}
            </div>
          )}
          <div className="alert info" style={{ marginTop: 12, marginBottom: 0 }}>{d.note}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>حركة الخزينة</h3>
        {d.movements.length === 0 && <Empty title="لا توجد حركات" />}
        {d.movements.length > 0 && (
          <div className="table-wrap" style={{ border: 'none', maxHeight: '60vh' }}>
            <table className="table">
              <thead>
                <tr><th>الحركة</th><th>المبلغ</th><th>البيان</th><th>الطريقة</th><th>الموظف</th><th>الإيصال</th><th>التاريخ والوقت</th></tr>
              </thead>
              <tbody>
                {d.movements.map((m, i) => (
                  <tr key={`${m.receipt_number}-${m.direction}-${i}`}>
                    <td>
                      <span className={`badge ${m.direction === 'in' ? 'ok' : 'bad'}`}>
                        {m.direction === 'in' ? 'وارد' : 'عكسي'}
                      </span>
                    </td>
                    <td className="num">
                      <b style={{ color: m.direction === 'in' ? 'var(--ok)' : 'var(--bad)' }}>
                        {m.direction === 'in' ? '+' : '−'}{money(m.amount, false)}
                      </b>
                    </td>
                    <td className="clickable" onClick={() => navigate(`/students/${m.student_id}`)}>
                      {m.kind} — {m.student_name}
                    </td>
                    <td>{m.method_name}</td>
                    <td className="hint">{m.user_name || '—'}</td>
                    <td className="num">{m.receipt_number}</td>
                    <td className="num hint">{dateTime(m.happened_at)}</td>
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

const Box = ({ label, value, hint, tone = '', icon }) => (
  <div className={`stat ${tone}`}>
    <div className="label">{icon && <Icon name={icon} size={14} />}{label}</div>
    <div className="value num">{value}</div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);
