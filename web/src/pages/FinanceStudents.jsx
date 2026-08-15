import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, dateOnly } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';
import InstallmentPay from '../components/InstallmentPay.jsx';

const TABS = [
  ['all', 'الكل'], ['paid', 'مسدد بالكامل'], ['partial', 'مسدد جزئيًا'], ['unpaid', 'غير مسدد']
];

/** الطلبة والمدفوعات — الشاشة اليومية للمحاسب. */
export default function FinanceStudents() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('payment_status') || 'all');
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [late, setLate] = useState(params.get('late') === '1');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState(null);
  const [payInst, setPayInst] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25', payment_status: tab });
    if (q) qs.set('q', q);
    if (classId) qs.set('class_id', classId);
    if (late) qs.set('late', '1');
    api.get(`/finance/students?${qs}`).then(setData).catch(setError);
  }, [page, tab, q, classId, late]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/settings/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [tab, q, classId, late]);

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>الطلبة والمدفوعات</h1>
        {can('payments.create') && (
          <button className="btn btn-ok" onClick={() => navigate('/pay')}><Icon name="cash" size={16} />تسجيل دفعة</button>
        )}
      </div>

      {data && (
        <div className="grid g4 mb">
          <Box label="عدد الطلاب" value={num(data.totals.count)} />
          <Box label="إجمالي الرسوم" value={money(data.totals.total_due)} />
          <Box label="المحصّل" value={money(data.totals.total_paid)} tone="ok" />
          <Box label="المتبقي" value={money(data.totals.balance)} tone="bad" />
        </div>
      )}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
        <button className={`tab ${late ? 'active' : ''}`} onClick={() => setLate((x) => !x)}>
          <Icon name="warn" size={14} />متأخرون في الأقساط
        </button>
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو الرقم الوطني أو الهاتف…" />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">كل الصفوف</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (data.rows.length === 0
        ? <div className="card"><Empty title="لا يوجد طلاب مطابقون" /></div>
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الطالب</th><th>الرقم الوطني</th><th>الصف</th><th>إجمالي الرسوم</th>
                    <th>المدفوع</th><th>المتبقي</th><th>القسط الحالي</th><th>الحالة</th><th>آخر دفعة</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((s) => (
                    <tr key={s.id}>
                      <td className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                        <b>{s.full_name}</b>
                        <div className="hint num">{s.student_number}</div>
                      </td>
                      <td className="num">{s.national_id}</td>
                      <td>{[s.class_name, s.section_name].filter(Boolean).join(' - ') || '—'}</td>
                      <td className="num">{money(s.total_due, false)}</td>
                      <td className="num">{money(s.total_paid, false)}</td>
                      <td className="num"><b style={{ color: Number(s.balance) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                        {money(s.balance, false)}</b></td>
                      <td>
                        {s.current_installment ? (
                          <>
                            <b className="small">{s.current_installment.name_ar}</b>
                            <div className="hint num">
                              {money(s.current_installment.paid, false)} / {money(s.current_installment.amount, false)}
                              {s.current_installment.due_date ? ` · ${dateOnly(s.current_installment.due_date)}` : ''}
                            </div>
                            <div className="bar-mini"><i style={{ width: `${s.current_installment.percent}%` }} /></div>
                          </>
                        ) : <span className="hint">—</span>}
                      </td>
                      <td><StatusBadge status={s.payment_status} /></td>
                      <td className="hint num">
                        {s.last_payment
                          ? `${money(s.last_payment.amount, false)} · ${dateOnly(s.last_payment.paid_at)}`
                          : '—'}
                      </td>
                      <td className="actions">
                        {can('payments.create') && Number(s.balance) > 0 && (
                          <>
                            {s.current_installment && (
                              <button className="btn btn-sm btn-ok"
                                onClick={() => setPayInst({ id: s.current_installment.id, student: s.full_name })}>
                                دفع القسط
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => navigate(`/pay/${s.id}`)}>
                              <Icon name="cash" size={14} />دفعة
                            </button>
                          </>
                        )}
                        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/students/${s.id}`)}>الحساب</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        ))}

      {payInst && (
        <InstallmentPay
          installmentId={payInst.id}
          onClose={() => setPayInst(null)}
          onDone={(out) => { setPayInst(null); toast.ok(out.message); load(); }}
        />
      )}
    </div>
  );
}

const Box = ({ label, value, tone = '' }) => (
  <div className={`stat ${tone}`}><div className="label">{label}</div><div className="value num">{value}</div></div>
);
