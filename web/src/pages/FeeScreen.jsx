import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';
import { SplitBar } from '../components/charts.jsx';

const TABS = [['all', 'الكل'], ['paid', 'مدفوعة'], ['partial', 'جزئية'], ['unpaid', 'غير مدفوعة'], ['not_required', 'غير مطلوبة']];

/** شاشة بند رسوم واحد: رسوم التسجيل، الزي المدرسي، أو أي بند آخر. */
export default function FeeScreen() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    if (status !== 'all') qs.set('status', status);
    if (q) qs.set('q', q);
    api.get(`/fees/summary/${code}?${qs}`).then(setData).catch(setError);
  }, [code, status, q, page]);

  useEffect(load, [load]);
  useEffect(() => { setPage(1); setData(null); }, [code, status, q]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const t = data.totals;

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>{data.fee_type.name_ar}</h1>
        <span className="badge info">{data.year.name}</span>
      </div>

      <div className="grid g4">
        <div className="stat"><div className="label">عدد الطلاب</div><div className="value num">{num(t.count)}</div></div>
        <div className="stat"><div className="label">إجمالي المستحق</div><div className="value num">{money(t.due)}</div></div>
        <div className="stat ok"><div className="label">المحصّل</div><div className="value num">{money(t.paid)}</div></div>
        <div className="stat bad"><div className="label">المتبقي</div><div className="value num">{money(t.remaining)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <SplitBar paid={t.paid} balance={t.remaining} />
      </div>

      <div className="tabs" style={{ marginTop: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث عن طالب…" />
      </div>

      {data.rows.length === 0
        ? <div className="card"><Empty title="لا توجد سجلات مطابقة" /></div>
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>رقم الطالب</th><th>الرقم الوطني</th><th>الاسم</th><th>الصف</th>
                    <th>القيمة</th><th>الخصم</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th></tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.student_id} className="clickable" onClick={() => navigate(`/students/${row.student_id}`)}>
                      <td className="num">{row.student_number}</td>
                      <td className="num">{row.national_id}</td>
                      <td><b>{row.full_name}</b></td>
                      <td>{row.class_name || '—'}</td>
                      <td className="num">{money(row.amount, false)}</td>
                      <td className="num">{money(row.discount, false)}</td>
                      <td className="num">{money(row.paid, false)}</td>
                      <td className="num"><b>{row.required ? money(row.remaining, false) : '—'}</b></td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        {can('payments.create') && row.required && Number(row.remaining) > 0 && (
                          <button className="btn btn-sm btn-ok" onClick={() => navigate(`/pay/${row.student_id}`)}>
                            <Icon name="cash" size={14} />دفعة
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pages={data.pages} total={t.count} onPage={setPage} />
          </>
        )}
    </div>
  );
}
