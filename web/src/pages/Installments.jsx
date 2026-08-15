import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money, dateOnly, num } from '../lib/format.js';
import { Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';

export default function Installments() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    if (q) qs.set('q', q);
    api.get(`/fees/installments?${qs}`).then(setData).catch(setError);
  }, [q, page]);

  useEffect(load, [load]);
  useEffect(() => { setPage(1); }, [q]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const late = data.rows.filter((r) => r.status === 'late').length;

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>الأقساط</h1>
        <span className="badge info">{data.year?.name}</span>
      </div>

      {late > 0 && <div className="alert warn">يوجد <b>{num(late)}</b> قسط متأخر عن تاريخ الاستحقاق.</div>}

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث عن طالب…" />
      </div>

      {data.rows.length === 0
        ? (
          <div className="card">
            <Empty title="لا توجد أقساط" hint="الأقساط اختيارية — يمكن إضافتها من ملف الطالب، والنظام يعمل بدونها." />
          </div>
        )
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>الطالب</th><th>الرقم الوطني</th><th>القسط</th><th>القيمة</th>
                    <th>الاستحقاق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/students/${r.student_id}`)}>
                      <td><b>{r.full_name}</b></td>
                      <td className="num">{r.national_id}</td>
                      <td>{r.name_ar}</td>
                      <td className="num">{money(r.amount, false)}</td>
                      <td className="num">{r.due_date ? dateOnly(r.due_date) : '—'}</td>
                      <td className="num">{money(r.paid, false)}</td>
                      <td className="num"><b>{money(r.remaining, false)}</b></td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        )}
    </div>
  );
}
