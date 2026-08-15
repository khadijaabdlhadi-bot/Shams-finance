import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download, openPrint } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, today, monthStart, dateTime } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, StatusBadge } from '../components/ui.jsx';
import { LabeledBars } from '../components/charts.jsx';

const TYPES = [
  ['students', 'الطلاب المالي'],
  ['daily', 'تحصيلات اليوم'],
  ['collections', 'التحصيلات خلال فترة'],
  ['staff', 'تقرير الموظفين'],
  ['discounts', 'الخصومات'],
  ['voided', 'الإيصالات الملغاة']
];

export default function Reports() {
  const { can, toast } = useApp();
  const [params] = useSearchParams();
  const [type, setType] = useState(params.get('type') || 'students');
  const [filters, setFilters] = useState({
    from: today(), to: today(), payment_status: 'all', class_id: '', user_id: '', only_balance: ''
  });
  const [classes, setClasses] = useState([]);
  const [users, setUsers] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const qs = () => {
    const q = new URLSearchParams();
    if (['collections', 'staff', 'voided'].includes(type)) { q.set('from', filters.from); q.set('to', filters.to); }
    if (type === 'daily') { q.set('date', filters.from); }
    if (type === 'students') {
      if (filters.payment_status !== 'all') q.set('payment_status', filters.payment_status);
      if (filters.class_id) q.set('class_id', filters.class_id);
      if (filters.only_balance) q.set('only_balance', '1');
    }
    if (type === 'staff' && filters.user_id) q.set('user_id', filters.user_id);
    return q.toString();
  };

  const load = useCallback(() => {
    setError(null); setData(null);
    api.get(`/reports/${type}?${qs()}`).then(setData).catch(setError);
  }, [type, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);
  useEffect(() => {
    api.get('/settings/classes').then(setClasses).catch(() => {});
    if (can('users.manage')) api.get('/users').then(setUsers).catch(() => {});
  }, [can]);

  const exportFile = async (fmt) => {
    try {
      await download(`/reports/${type}/export.${fmt}?${qs()}`, `report-${type}.${fmt}`);
    } catch (err) { toast.error(err.message); }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <h1>التقارير المالية</h1>

      <div className="tabs">
        {TYPES.map(([k, label]) => (
          <button key={k} className={`tab ${type === k ? 'active' : ''}`} onClick={() => setType(k)}>{label}</button>
        ))}
      </div>

      <div className="toolbar">
        {['collections', 'staff', 'voided'].includes(type) && (
          <>
            <input className="input" type="date" style={{ width: 160 }} value={filters.from} onChange={set('from')} />
            <input className="input" type="date" style={{ width: 160 }} value={filters.to} onChange={set('to')} />
            <button className="btn btn-sm" onClick={() => setFilters((f) => ({ ...f, from: today(), to: today() }))}>اليوم</button>
            <button className="btn btn-sm" onClick={() => setFilters((f) => ({ ...f, from: monthStart(), to: today() }))}>هذا الشهر</button>
          </>
        )}
        {type === 'daily' && (
          <input className="input" type="date" style={{ width: 160 }} value={filters.from} onChange={set('from')} />
        )}
        {type === 'students' && (
          <>
            <select className="select" style={{ width: 'auto' }} value={filters.payment_status} onChange={set('payment_status')}>
              <option value="all">كل الحالات</option>
              <option value="paid">مسدد بالكامل</option>
              <option value="partial">مسدد جزئيًا</option>
              <option value="unpaid">غير مسدد</option>
            </select>
            <select className="select" style={{ width: 'auto' }} value={filters.class_id} onChange={set('class_id')}>
              <option value="">كل الصفوف</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={!!filters.only_balance}
                onChange={(e) => setFilters((f) => ({ ...f, only_balance: e.target.checked ? '1' : '' }))} />
              عليهم متبقٍ فقط
            </label>
          </>
        )}
        {type === 'staff' && users.length > 0 && (
          <select className="select" style={{ width: 'auto' }} value={filters.user_id} onChange={set('user_id')}>
            <option value="">كل الموظفين</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}

        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => openPrint(`/reports/${type}/print?${qs()}`)}>
          <Icon name="print" size={15} />طباعة
        </button>
        {can('reports.export') && (
          <>
            <button className="btn btn-sm" onClick={() => exportFile('xlsx')}><Icon name="download" size={15} />Excel</button>
            <button className="btn btn-sm" onClick={() => exportFile('pdf')}><Icon name="download" size={15} />PDF</button>
          </>
        )}
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (
        <>
          <div className="card">
            <div className="card-head"><h3>{data.title}</h3></div>

            {data.totals && (
              <div className="grid g4" style={{ marginBottom: 12 }}>
                {Object.entries(data.totals).map(([k, val]) => (
                  <div className="stat" key={k}>
                    <div className="label">{TOTAL_LABELS[k] || k}</div>
                    <div className="value num" style={{ fontSize: '1.15rem' }}>
                      {k === 'count' ? num(val) : money(val)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.by_method?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <h4>حسب طريقة الدفع</h4>
                <LabeledBars data={data.by_method} />
              </div>
            )}

            {data.rows.length === 0
              ? <Empty title="لا توجد بيانات ضمن هذه الفلاتر" />
              : (
                <div className="table-wrap" style={{ border: 'none', maxHeight: '60vh' }}>
                  <table className="table">
                    <thead><tr>{data.columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        <tr key={i}>
                          {data.columns.map(([key]) => (
                            <td key={key} className={MONEY_KEYS.has(key) || key.includes('id') || key === 'time' ? 'num' : ''}>
                              {renderCell(key, row[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
          <p className="hint">التصدير والطباعة يحترمان نفس الفلاتر المعروضة الآن.</p>
        </>
      )}
    </div>
  );
}

const MONEY_KEYS = new Set(['total_due', 'total_paid', 'balance', 'amount', 'total', 'cash', 'card', 'transfer', 'discount', 'total_discount']);
const TOTAL_LABELS = {
  count: 'عدد السجلات', total_due: 'إجمالي المستحق', total_paid: 'إجمالي المحصّل',
  balance: 'إجمالي المتبقي', total_discount: 'إجمالي الخصومات', total: 'الإجمالي'
};

function renderCell(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'payment_status_ar') return <StatusBadge status="" label={value} />;
  if (MONEY_KEYS.has(key)) return money(value, false);
  if (key.endsWith('_at') || key === 'discount_at') return dateTime(value);
  return String(value);
}
