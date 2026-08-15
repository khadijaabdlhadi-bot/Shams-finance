import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { Spinner, Empty, ErrorBox, Pager, SearchBox, Modal } from '../components/ui.jsx';

export default function AuditLog() {
  const [filters, setFilters] = useState({ q: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '30' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
    api.get(`/audit?${qs}`).then(setData).catch(setError);
  }, [page, filters]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/audit/actions').then(setActions).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [filters]);

  return (
    <div>
      <h1>سجل العمليات</h1>
      <p className="hint">
        كل عملية في النظام مسجّلة باسم منفّذها ووقت الخادم — لا يمكن كتابة اسم المنفّذ يدويًا ولا تعديل السجل.
      </p>

      <div className="toolbar">
        <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} placeholder="ابحث في الوصف أو اسم المستخدم…" />
        <select className="select" style={{ width: 'auto' }} value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
          <option value="">كل العمليات</option>
          {actions.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
        </select>
        <input className="input" type="date" style={{ width: 155 }} value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input className="input" type="date" style={{ width: 155 }} value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (data.rows.length === 0
        ? <div className="card"><Empty title="لا توجد عمليات مطابقة" /></div>
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>التاريخ والوقت</th><th>المستخدم</th><th>العملية</th><th>الوصف</th><th>الطالب</th><th>IP</th><th></th></tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="num">{dateTime(row.created_at)}</td>
                      <td><b>{row.full_name || '—'}</b><div className="hint">{row.username}</div></td>
                      <td><span className="badge grey">{row.action_label}</span></td>
                      <td style={{ whiteSpace: 'normal', minWidth: 260 }}>{row.description}</td>
                      <td>{row.student_name || '—'}</td>
                      <td className="num hint">{row.ip_address || '—'}</td>
                      <td>
                        {(row.old_values || row.new_values) && (
                          <button className="btn btn-sm btn-ghost" onClick={() => setDetail(row)}>التفاصيل</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        ))}

      {detail && (
        <Modal title={`تفاصيل العملية · ${detail.action_label}`} onClose={() => setDetail(null)}>
          <div className="kv" style={{ marginBottom: 12 }}>
            <dt>المنفّذ</dt><dd>{detail.full_name} ({detail.username})</dd>
            <dt>الوقت</dt><dd className="num">{dateTime(detail.created_at)}</dd>
            <dt>الكيان</dt><dd>{detail.entity} #{detail.entity_id}</dd>
            <dt>المتصفح</dt><dd className="hint" style={{ fontWeight: 400 }}>{detail.user_agent || '—'}</dd>
          </div>
          <div className="grid g2">
            <div>
              <h4>القيم القديمة</h4>
              <pre className="card" style={{ fontSize: '.75rem', direction: 'ltr', overflow: 'auto' }}>
                {JSON.stringify(detail.old_values || {}, null, 2)}
              </pre>
            </div>
            <div>
              <h4>القيم الجديدة</h4>
              <pre className="card" style={{ fontSize: '.75rem', direction: 'ltr', overflow: 'auto' }}>
                {JSON.stringify(detail.new_values || {}, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
