import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openPrint } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, dateTime, today, monthStart } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge, Modal } from '../components/ui.jsx';

export default function Payments() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: 'all', method_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [methods, setMethods] = useState([]);
  const [voidTarget, setVoidTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
    api.get(`/payments?${qs}`).then(setData).catch(setError);
  }, [page, filters]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/settings/payment-methods').then(setMethods).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [filters]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const doVoid = async (reason) => {
    setBusy(true);
    try {
      const out = await api.post(`/payments/${voidTarget.id}/void`, { reason });
      toast.ok(out.message);
      setVoidTarget(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h1>جميع الدفعات</h1>

      <div className="toolbar">
        <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))}
          placeholder="ابحث برقم الإيصال أو اسم الطالب أو الرقم الوطني…" />
        <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={set('status')}>
          <option value="all">كل الحالات</option>
          <option value="active">سارية</option>
          <option value="void">ملغاة</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.method_id} onChange={set('method_id')}>
          <option value="">كل طرق الدفع</option>
          {methods.map((m) => <option key={m.id} value={m.id}>{m.name_ar}</option>)}
        </select>
        <input className="input" type="date" style={{ width: 155 }} value={filters.from} onChange={set('from')} title="من تاريخ" />
        <input className="input" type="date" style={{ width: 155 }} value={filters.to} onChange={set('to')} title="إلى تاريخ" />
        <button className="btn btn-sm" onClick={() => setFilters({ q: '', status: 'all', method_id: '', from: today(), to: today() })}>اليوم</button>
        <button className="btn btn-sm" onClick={() => setFilters({ q: '', status: 'all', method_id: '', from: monthStart(), to: today() })}>هذا الشهر</button>
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (
        <>
          <div className="alert info">
            عدد الدفعات المعروضة: <b>{data.total}</b> · إجمالي المبالغ السارية: <b className="num">{money(data.sum)}</b>
          </div>

          {data.rows.length === 0
            ? <div className="card"><Empty title="لا توجد دفعات مطابقة" /></div>
            : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>الإيصال</th><th>التاريخ والوقت</th><th>الطالب</th><th>الرقم الوطني</th>
                      <th>المبلغ</th><th>الطريقة</th><th>الموظف</th><th>الحالة</th><th></th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map((p) => (
                      <tr key={p.id}>
                        <td className="num">{p.receipt_number}</td>
                        <td className="num">{dateTime(p.paid_at)}</td>
                        <td className="clickable" onClick={() => navigate(`/students/${p.student_id}`)}><b>{p.full_name}</b></td>
                        <td className="num">{p.national_id}</td>
                        <td className="num"><b>{money(p.amount, false)}</b></td>
                        <td>{p.method_name}</td>
                        <td className="hint">{p.cashier}</td>
                        <td><StatusBadge status={p.status} />{p.status === 'void' && <div className="hint">{p.void_reason}</div>}</td>
                        <td className="actions">
                          {can('receipts.print') && (
                            <button className="btn btn-sm" onClick={async () => {
                              const full = await api.get(`/payments/${p.id}`);
                              openPrint(`/receipts/${full.receipt_id}/print`);
                            }}><Icon name="print" size={14} /></button>
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
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
        </>
      )}

      {voidTarget && (
        <VoidModal payment={voidTarget} busy={busy} onClose={() => setVoidTarget(null)} onConfirm={doVoid} />
      )}
    </div>
  );
}

function VoidModal({ payment, onClose, onConfirm, busy }) {
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
        الدفعة لن تُحذف — ستُعلَّم «ملغاة» ولن تدخل في التحصيلات، وسيُعاد حساب رصيد الطالب.
      </div>
      <div className="field">
        <label>سبب الإلغاء <span className="req">*</span></label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}
