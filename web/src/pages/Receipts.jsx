import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openPrint, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, dateTime } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';

export default function Receipts() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: 'all', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pdfOk, setPdfOk] = useState(true);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
    api.get(`/receipts?${qs}`).then(setData).catch(setError);
  }, [page, filters]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/receipts/status/pdf').then((d) => setPdfOk(d.available)).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [filters]);

  return (
    <div>
      <h1>الإيصالات</h1>

      {!pdfOk && (
        <div className="alert warn">
          تنزيل PDF غير مفعّل على هذا الخادم. زر «طباعة» يعمل، ومن نافذة الطباعة يمكن اختيار «حفظ كـ PDF».
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} placeholder="رقم الإيصال أو اسم الطالب…" />
        <select className="select" style={{ width: 'auto' }} value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="all">الكل</option>
          <option value="active">سارية</option>
          <option value="void">ملغاة</option>
        </select>
        <input className="input" type="date" style={{ width: 155 }} value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input className="input" type="date" style={{ width: 155 }} value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (data.rows.length === 0
        ? <div className="card"><Empty title="لا توجد إيصالات" hint="يُنشأ الإيصال تلقائيًا مع كل دفعة." /></div>
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>رقم الإيصال</th><th>التاريخ</th><th>الطالب</th><th>الرقم الوطني</th>
                    <th>المبلغ</th><th>الموظف</th><th>مرات الطباعة</th><th>الحالة</th><th></th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.receipt_number}</td>
                      <td className="num">{dateTime(r.created_at)}</td>
                      <td className="clickable" onClick={() => navigate(`/students/${r.student_id}`)}><b>{r.full_name}</b></td>
                      <td className="num">{r.national_id}</td>
                      <td className="num"><b>{money(r.amount, false)}</b></td>
                      <td className="hint">{r.cashier}</td>
                      <td className="num">{r.print_count}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="actions">
                        <button className="btn btn-sm btn-ghost" onClick={() => openPrint(`/receipts/${r.id}/preview`)}>
                          <Icon name="eye" size={14} />
                        </button>
                        {can('receipts.print') && (
                          <>
                            <button className="btn btn-sm" onClick={() => openPrint(`/receipts/${r.id}/print`).then(load)}>
                              <Icon name="print" size={14} />{r.print_count > 0 ? 'إعادة طباعة' : 'طباعة'}
                            </button>
                            <button className="btn btn-sm btn-ghost" disabled={!pdfOk}
                              onClick={() => download(`/receipts/${r.id}/pdf`, `${r.receipt_number}.pdf`).then(load).catch((e) => toast.error(e.message))}>
                              PDF
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
            <p className="hint">كل عملية طباعة أو إعادة طباعة تُسجَّل في سجل العمليات باسم منفّذها ووقتها.</p>
          </>
        ))}
    </div>
  );
}
