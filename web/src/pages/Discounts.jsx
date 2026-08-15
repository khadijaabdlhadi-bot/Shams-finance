import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, download, openPrint } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num, dateTime } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, SearchBox } from '../components/ui.jsx';

/** خصومات الطلبة — كل خصم بسببه ومن اعتمده ومتى. */
export default function Discounts() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);

  const load = () => { setError(null); api.get('/finance/discounts').then(setD).catch(setError); };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d) return <Spinner />;

  const rows = d.rows.filter((r) => !q
    || r.full_name.includes(q) || String(r.national_id).includes(q) || String(r.fee_name).includes(q));

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>خصومات الطلبة</h1>
        <button className="btn btn-sm" onClick={() => openPrint('/reports/discounts/print')}>
          <Icon name="print" size={15} />طباعة
        </button>
        {can('reports.export') && (
          <button className="btn btn-sm" onClick={() => download('/reports/discounts/export.xlsx', 'discounts.xlsx').catch((e) => toast.error(e.message))}>
            <Icon name="download" size={15} />Excel
          </button>
        )}
      </div>

      <div className="grid g2 mb">
        <div className="stat warn">
          <div className="label">إجمالي الخصومات</div>
          <div className="value num">{money(d.total)}</div>
        </div>
        <div className="stat">
          <div className="label">عدد الخصومات</div>
          <div className="value num">{num(d.count)}</div>
        </div>
      </div>

      <div className="alert info">
        الخصم يُمنح من ملف الطالب ← <b>تعديل الرسوم</b>، ويحتاج صلاحية «منح خصم»، ويُسجَّل بسببه ومنفّذه في سجل العمليات.
        لا يمكن تعديل المدفوع يدويًا — الزيادة تكون بتسجيل دفعة فقط.
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث باسم الطالب أو الرقم الوطني…" />
      </div>

      {rows.length === 0
        ? <div className="card"><Empty title="لا توجد خصومات" hint="ستظهر هنا فور منح أول خصم." /></div>
        : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الطالب</th><th>الرقم الوطني</th><th>الصف</th><th>البند</th>
                  <th>القيمة الأصلية</th><th>الخصم</th><th>السبب</th><th>اعتمده</th><th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="clickable" onClick={() => navigate(`/students/${r.student_id}`)}>
                    <td><b>{r.full_name}</b><div className="hint num">{r.student_number}</div></td>
                    <td className="num">{r.national_id}</td>
                    <td>{r.class_name || '—'}</td>
                    <td>{r.fee_name}</td>
                    <td className="num">{money(r.amount, false)}</td>
                    <td className="num"><b style={{ color: 'var(--warn)' }}>{money(r.discount, false)}</b></td>
                    <td>{r.discount_reason || '—'}</td>
                    <td className="hint">{r.granted_by || '—'}</td>
                    <td className="num hint">{r.discount_at ? dateTime(r.discount_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
