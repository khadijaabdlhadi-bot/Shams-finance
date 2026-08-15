import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num } from '../lib/format.js';
import { Icon, Spinner, ErrorBox } from '../components/ui.jsx';
import { SplitBar, Donut } from '../components/charts.jsx';

/** لوحة القسم المالي — كل ما يحتاجه المحاسب في مكان واحد. */
const CARDS = [
  ['/finance/students', 'users', 'الطلبة والمدفوعات', 'حساب كل طالب وقسطه الحالي وآخر دفعة، مع تسجيل دفعة بضغطة', 'blue', 'payments.view'],
  ['/finance/installments', 'calendar', 'الأقساط', 'كل الأقساط وحالتها: مدفوع · جزئي · متأخر', 'gold', 'fees.view'],
  ['/finance/treasury', 'cash', 'الخزينة', 'ما دخل فعليًا اليوم والشهر، وحركة كل دفعة', 'green', 'payments.view'],
  ['/finance/debts', 'warn', 'ديون الطلبة', 'من عليه متبقٍ ومن تأخر عن قسطه', 'rose', 'payments.view'],
  ['/finance/discounts', 'badge', 'الخصومات', 'كل خصم بسببه ومن اعتمده', 'violet', 'fees.view'],
  ['/finance/methods', 'list', 'طرق الدفع', 'نقدًا · بطاقة · تحويل مصرفي، وإضافة طرق جديدة', 'blue', null],
  ['/reports', 'chart', 'التقارير المالية', 'تقارير بفلاتر، وتصدير Excel و PDF وطباعة', 'green', 'reports.view'],
  ['/pay', 'plus', 'تسجيل دفعة', 'ابحث عن الطالب وسجّل الدفعة واطبع الإيصال', 'gold', 'payments.create']
];

export default function Finance() {
  const { can } = useApp();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  const load = () => { setError(null); api.get('/finance/overview').then(setD).catch(setError); };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d) return <Spinner />;

  const cards = CARDS.filter(([, , , , , perm]) => can(perm));

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>المالية</h1>
        <span className="badge info">{d.year?.name}</span>
      </div>

      <div className="grid g4">
        <Stat label="إجمالي الرسوم" value={money(d.totals.total_due)} icon="cash" />
        <Stat label="المحصّل" value={money(d.totals.total_paid)} icon="check" tone="ok" />
        <Stat label="المتبقي (الديون)" value={money(d.totals.balance)} icon="warn" tone="bad"
          hint={`${num(d.debts.count)} طالب عليه متبقٍ`} />
        <Stat label="تحصيلات اليوم" value={money(d.today.total)} icon="chart" tone="ok"
          hint={`${num(d.today.count)} دفعة`} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>التحصيل مقابل المتبقي</h3>
          <SplitBar paid={d.totals.total_paid} balance={d.totals.balance} />
          <div className="grid g3" style={{ marginTop: 14 }}>
            <MiniStat label="الأقساط" value={num(d.installments.total)} hint={`${num(d.installments.late)} متأخر`} />
            <MiniStat label="متبقي الأقساط" value={money(d.installments.remaining)} />
            <MiniStat label="الخصومات" value={money(d.discounts.total)} hint={`${num(d.discounts.count)} خصم`} />
          </div>
        </div>
        <div className="card">
          <h3>حالات السداد</h3>
          <Donut data={[
            { label: 'مسدد بالكامل', value: d.statuses.paid },
            { label: 'مسدد جزئيًا', value: d.statuses.partial },
            { label: 'غير مسدد', value: d.statuses.unpaid }
          ]} />
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>أقسام المالية</h3>
      <div className="grid g4 fin-cards">
        {cards.map(([to, icon, title, desc, tone]) => (
          <button key={to} className={`fin-card ${tone}`} onClick={() => navigate(to)}>
            <span className="ico"><Icon name={icon} size={22} /></span>
            <b>{title}</b>
            <small>{desc}</small>
            <span className="go"><Icon name="back" size={16} /></span>
          </button>
        ))}
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        كل الأرقام أعلاه محسوبة مباشرة من الدفعات والرسوم في قاعدة البيانات، وليست قيمًا مخزّنة.
        {' '}<Link to="/reports">التقارير التفصيلية</Link>
      </p>
    </div>
  );
}

const Stat = ({ label, value, hint, icon, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="label">{icon && <Icon name={icon} size={14} />}{label}</div>
    <div className="value num">{value}</div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);

const MiniStat = ({ label, value, hint }) => (
  <div className="stat">
    <div className="label">{label}</div>
    <div className="value num" style={{ fontSize: '1.1rem' }}>{value}</div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);
