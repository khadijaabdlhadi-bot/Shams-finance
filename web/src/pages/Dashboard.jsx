import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, timeOnly } from '../lib/format.js';
import { Icon, Spinner, ErrorBox, Empty } from '../components/ui.jsx';
import { SplitBar, Bars, LabeledBars, Donut } from '../components/charts.jsx';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function Dashboard() {
  const { can } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    api.get('/dashboard').then(setData).catch(setError);
  };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const t = data.totals;
  const feeOf = (code) => data.fees.find((f) => f.code === code) || { due: '0.00', paid: '0.00' };

  const quick = [
    ['إضافة طالب', 'plus', '/students?new=1', 'students.create'],
    ['تسجيل دفعة', 'cash', '/pay', 'payments.create'],
    ['استيراد Excel', 'upload', '/import', 'excel.import'],
    ['تحصيلات اليوم', 'chart', '/reports?type=daily', 'reports.view'],
    ['غير المسددين', 'users', '/students?payment_status=unpaid', 'students.view'],
    ['نسخة احتياطية', 'save', '/backup', 'backup.manage']
  ].filter(([, , , perm]) => can(perm));

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>لوحة التحكم</h1>
        <span className="badge info">{data.year?.name}</span>
      </div>

      <div className="toolbar">
        {quick.map(([label, icon, to]) => (
          <button key={to} className="btn btn-sm" onClick={() => navigate(to)}>
            <Icon name={icon} size={15} />{label}
          </button>
        ))}
      </div>

      <div className="grid g4">
        <Stat label="إجمالي الطلاب" value={num(t.students)} icon="users" />
        <Stat label="إجمالي المستحق" value={money(t.total_due)} icon="cash" />
        <Stat label="إجمالي المحصّل" value={money(t.total_paid)} icon="check" tone="ok" />
        <Stat label="إجمالي المتبقي" value={money(t.balance)} icon="warn" tone="bad" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>المحصّل مقابل المتبقي</h3>
          <SplitBar paid={t.total_paid} balance={t.balance} />
          <div className="grid g3" style={{ marginTop: 14 }}>
            <Stat small label="تحصيلات اليوم" value={money(data.today.total)} hint={`${num(data.today.count)} دفعة`} tone="ok" />
            <Stat small label="تحصيلات الشهر" value={money(data.month.total)} hint={`${num(data.month.count)} دفعة`} />
            <Stat small label="إجمالي الخصومات" value={money(t.total_discount)} tone="warn" />
          </div>
        </div>

        <div className="card">
          <h3>حالات السداد</h3>
          <Donut data={data.charts.statuses} />
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>التحصيلات الشهرية</h3>
          <Bars data={(data.charts.monthly || []).map((m) => ({
            label: MONTHS[Number(m.month.slice(5, 7)) - 1]?.slice(0, 4) || m.month,
            value: m.value
          }))} />
        </div>
        <div className="card">
          <h3>طرق الدفع</h3>
          <LabeledBars data={data.charts.methods} />
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>الرسوم حسب البند</h3>
          <div className="rows">
            {data.fees.map((f) => {
              const due = Number(f.due); const paid = Number(f.paid);
              const pct = due > 0 ? Math.round((paid / due) * 100) : 0;
              return (
                <div key={f.code} className="row">
                  <span className="name">{f.name_ar}</span>
                  <span className="num hint">{money(f.paid, false)} / {money(f.due, false)}</span>
                  <span className={`badge ${pct >= 100 ? 'ok' : pct > 0 ? 'warn' : 'grey'}`}>{pct}%</span>
                </div>
              );
            })}
          </div>
          <div className="chart-note" style={{ marginTop: 8 }}>
            رسوم التسجيل: {money(feeOf('registration').paid)} من {money(feeOf('registration').due)} ·
            الزي: {money(feeOf('uniform').paid)} من {money(feeOf('uniform').due)}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>آخر الدفعات</h3>
            <Link className="btn btn-sm btn-ghost" to="/payments">عرض الكل</Link>
          </div>
          {data.recent_payments.length === 0 && <Empty title="لا توجد دفعات بعد" hint="ستظهر هنا فور تسجيل أول دفعة." />}
          {data.recent_payments.length > 0 && (
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="table">
                <thead><tr><th>الوقت</th><th>الطالب</th><th>المبلغ</th><th>الطريقة</th><th>الموظف</th></tr></thead>
                <tbody>
                  {data.recent_payments.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/students/${p.student_id}`)}>
                      <td className="num">{timeOnly(p.paid_at)}</td>
                      <td>{p.full_name}</td>
                      <td className="num"><b>{money(p.amount)}</b></td>
                      <td>{p.method_name}</td>
                      <td className="hint">{p.cashier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, icon, tone = '', small = false }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="label">{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className="value num" style={small ? { fontSize: '1.15rem' } : undefined}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
