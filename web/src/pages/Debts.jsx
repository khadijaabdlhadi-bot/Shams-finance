import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, dateOnly } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge } from '../components/ui.jsx';

/** ديون الطلبة — من عليه متبقٍ، والأكبر أولًا. */
export default function Debts() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [late, setLate] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25' });
    if (q) qs.set('q', q);
    if (classId) qs.set('class_id', classId);
    if (late) qs.set('late', '1');
    api.get(`/finance/debts?${qs}`).then(setData).catch(setError);
  }, [page, q, classId, late]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/settings/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [q, classId, late]);

  const exportDebts = async () => {
    try {
      const qs = new URLSearchParams({ only_balance: '1' });
      if (classId) qs.set('class_id', classId);
      await download(`/excel/students/export.xlsx?${qs}`, 'debts.xlsx');
      toast.ok('تم تنزيل ملف الديون.');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>ديون الطلبة</h1>
        <button className="btn btn-sm" onClick={exportDebts}><Icon name="download" size={15} />تصدير Excel</button>
      </div>

      {data && (
        <div className="grid g2 mb">
          <div className="stat bad">
            <div className="label"><Icon name="warn" size={14} />إجمالي الديون</div>
            <div className="value num">{money(data.totals.debt)}</div>
          </div>
          <div className="stat">
            <div className="label">عدد الطلاب المدينين</div>
            <div className="value num">{num(data.totals.count)}</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو الرقم الوطني أو هاتف ولي الأمر…" />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">كل الصفوف</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <button className={`btn btn-sm ${late ? 'btn-primary' : ''}`} onClick={() => setLate((x) => !x)}>
          <Icon name="warn" size={15} />أقساط متأخرة فقط
        </button>
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && (data.rows.length === 0
        ? <div className="card"><Empty title="لا توجد ديون" hint="كل الطلاب المطابقين سدّدوا بالكامل." /></div>
        : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الطالب</th><th>الرقم الوطني</th><th>الصف</th><th>هاتف ولي الأمر</th>
                    <th>المستحق</th><th>المدفوع</th><th>الدين</th><th>القسط المتأخر</th><th>الحالة</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((s) => (
                    <tr key={s.id}>
                      <td className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                        <b>{s.full_name}</b><div className="hint num">{s.student_number}</div>
                      </td>
                      <td className="num">{s.national_id}</td>
                      <td>{s.class_name || '—'}</td>
                      <td className="num">{s.guardian_phone || '—'}</td>
                      <td className="num">{money(s.total_due, false)}</td>
                      <td className="num">{money(s.total_paid, false)}</td>
                      <td className="num"><b style={{ color: 'var(--bad)' }}>{money(s.balance, false)}</b></td>
                      <td>
                        {s.late_installment ? (
                          <>
                            <b className="small">{s.late_installment.name_ar}</b>
                            <div className="hint num">
                              {money(s.late_installment.remaining, false)}
                              {s.late_installment.due_date ? ` · ${dateOnly(s.late_installment.due_date)}` : ''}
                            </div>
                          </>
                        ) : <span className="hint">—</span>}
                      </td>
                      <td><StatusBadge status={s.payment_status} /></td>
                      <td className="actions">
                        {can('payments.create') && (
                          <button className="btn btn-sm btn-ok" onClick={() => navigate(`/pay/${s.id}`)}>
                            <Icon name="cash" size={14} />تسجيل دفعة
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
    </div>
  );
}
