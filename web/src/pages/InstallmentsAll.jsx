import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, dateOnly } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';
import InstallmentPay from '../components/InstallmentPay.jsx';

const TABS = [
  ['all', 'الكل'], ['late', 'متأخر'], ['due', 'مستحق'],
  ['partial', 'مدفوع جزئيًا'], ['unpaid', 'غير مدفوع'], ['paid', 'مدفوع بالكامل']
];

/** كل أقساط الطلاب في شاشة واحدة، الأكثر إلحاحًا أولًا. */
export default function InstallmentsAll() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState(null);
  const [payInst, setPayInst] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    if (status !== 'all') qs.set('status', status);
    if (q) qs.set('q', q);
    if (classId) qs.set('class_id', classId);
    api.get(`/finance/installments?${qs}`).then(setData).catch(setError);
  }, [page, status, q, classId]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/settings/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [status, q, classId]);

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>الأقساط</h1>
        {data && <span className="badge info">{data.year?.name}</span>}
      </div>

      {data && (
        <div className="grid g4 mb">
          <Box label="عدد الأقساط" value={num(data.totals.count)} />
          <Box label="إجمالي قيم الأقساط" value={money(data.totals.amount)} />
          <Box label="المدفوع منها" value={money(data.totals.paid)} tone="ok" />
          <Box label="المتبقي" value={money(data.totals.remaining)} tone="bad"
            hint={data.totals.late ? `${num(data.totals.late)} قسط متأخر` : ''} />
        </div>
      )}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث باسم الطالب أو الرقم الوطني أو اسم القسط…" />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">كل الصفوف</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (data.rows.length === 0
        ? (
          <div className="card">
            <Empty title="لا توجد أقساط مطابقة"
              hint="الأقساط اختيارية — تُضاف من ملف الطالب، والنظام يعمل بدونها." />
          </div>
        )
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الطالب</th><th>الرقم الوطني</th><th>الصف</th><th>القسط</th>
                    <th>القيمة</th><th>المدفوع</th><th>المتبقي</th><th>التقدّم</th>
                    <th>الاستحقاق</th><th>الحالة</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.installment_id}>
                      <td className="clickable" onClick={() => navigate(`/students/${row.student_id}`)}>
                        <b>{row.full_name}</b>
                      </td>
                      <td className="num">{row.national_id}</td>
                      <td>{row.class_name || '—'}</td>
                      <td><b>{row.name_ar}</b></td>
                      <td className="num">{money(row.amount, false)}</td>
                      <td className="num">{money(row.paid, false)}</td>
                      <td className="num"><b>{money(row.remaining, false)}</b></td>
                      <td style={{ minWidth: 120 }}>
                        <div className="bar-mini"><i style={{ width: `${row.percent}%` }} /></div>
                        <span className="hint num">{row.percent}%</span>
                      </td>
                      <td className="num hint">{row.due_date ? dateOnly(row.due_date) : '—'}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="actions">
                        {can('payments.create') && Number(row.remaining) > 0 && (
                          <button className="btn btn-sm btn-ok"
                            onClick={() => setPayInst(row.installment_id)}>
                            <Icon name="cash" size={14} />دفعة
                          </button>
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

      {payInst && (
        <InstallmentPay installmentId={payInst} onClose={() => setPayInst(null)}
          onDone={(out) => { setPayInst(null); toast.ok(out.message); load(); }} />
      )}
    </div>
  );
}

const Box = ({ label, value, hint, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="label">{label}</div>
    <div className="value num">{value}</div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);
