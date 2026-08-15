import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { money, num } from '../lib/format.js';
import { Icon, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge, Modal } from '../components/ui.jsx';

const TABS = [['all', 'الكل'], ['paid', 'مسدد بالكامل'], ['partial', 'مسدد جزئيًا'], ['unpaid', 'غير مسدد']];

export default function Students() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState(params.get('payment_status') || 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('active');
  const [classId, setClassId] = useState('');
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(params.get('new') === '1');
  const [exporting, setExporting] = useState(false);

  /**
   * تصدير الطلاب الموجودين فعليًا في قاعدة البيانات (وليس نموذجًا فارغًا).
   * withFilters=true ⇒ نفس ما تعرضه الشاشة الآن بالضبط.
   */
  const exportStudents = async (withFilters) => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (withFilters) {
        if (tab !== 'all') qs.set('payment_status', tab);
        if (q) qs.set('q', q);
        if (classId) qs.set('class_id', classId);
        if (status !== 'active') qs.set('status', status);
      }
      const name = withFilters ? 'students-filtered.xlsx' : 'students-all.xlsx';
      await download(`/excel/students/export.xlsx${qs.toString() ? `?${qs}` : ''}`, name);
      toast.ok(withFilters ? 'تم تصدير النتائج المعروضة.' : 'تم تصدير جميع الطلاب.');
    } catch (err) {
      toast.error(err.message);
    } finally { setExporting(false); }
  };

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ page: String(page), size: '25', payment_status: tab, status });
    if (q) qs.set('q', q);
    if (classId) qs.set('class_id', classId);
    api.get(`/students?${qs}`).then(setData).catch(setError);
    api.get('/students/counts').then(setCounts).catch(() => {});
  }, [page, tab, q, status, classId]);

  useEffect(load, [load]);
  useEffect(() => { api.get('/settings/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [tab, q, status, classId]);

  const onCreated = (student) => {
    setShowNew(false);
    params.delete('new'); setParams(params, { replace: true });
    toast.ok(`تم حفظ الطالب ${student.full_name} برقم ${student.student_number}`);
    load();
    navigate(`/students/${student.id}`);
  };

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>الطلاب</h1>
        <button className="btn btn-sm" disabled={exporting} onClick={() => exportStudents(true)}>
          <Icon name="download" size={15} />
          {exporting ? 'جارٍ التجهيز…' : 'تصدير النتائج الحالية'}
        </button>
        <button className="btn btn-sm" disabled={exporting} onClick={() => exportStudents(false)}>
          <Icon name="download" size={15} />تصدير جميع الطلاب
        </button>
        {can('excel.import') && (
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/import')}>
            <Icon name="upload" size={15} />استيراد / نموذج Excel
          </button>
        )}
        {can('students.create') && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={16} />إضافة طالب
          </button>
        )}
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label} {counts && <span className="count">({num(key === 'all' ? counts.all : counts[key])})</span>}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالرقم الوطني، رقم الطالب، الاسم، أو الهاتف…" />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">كل الصفوف</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">النشطون</option>
          <option value="archived">المؤرشفون</option>
          <option value="all">الكل</option>
        </select>
      </div>

      <ErrorBox error={error} onRetry={load} />
      {!data && !error && <Spinner />}

      {data && data.rows.length === 0 && (
        <div className="card"><Empty title="لا يوجد طلاب مطابقون" hint="جرّب تغيير البحث أو التبويب، أو أضف طالبًا جديدًا." /></div>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>رقم الطالب</th><th>الرقم الوطني</th><th>الاسم</th><th>الصف</th>
                  <th>هاتف ولي الأمر</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                    <td className="num">{s.student_number}</td>
                    <td className="num">{s.national_id}</td>
                    <td><b>{s.full_name}</b></td>
                    <td>{[s.class_name, s.section_name].filter(Boolean).join(' - ') || '—'}</td>
                    <td className="num">{s.guardian_phone || '—'}</td>
                    <td className="num">{money(s.total_due, false)}</td>
                    <td className="num">{money(s.total_paid, false)}</td>
                    <td className="num"><b>{money(s.balance, false)}</b></td>
                    <td><StatusBadge status={s.payment_status} /></td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {can('payments.create') && Number(s.balance) > 0 && (
                        <button className="btn btn-sm btn-ok" onClick={() => navigate(`/pay/${s.id}`)}>
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
      )}

      {showNew && <NewStudent onClose={() => setShowNew(false)} onCreated={onCreated} classes={classes} />}
    </div>
  );
}

/* ---------------- نافذة إضافة طالب ---------------- */

function NewStudent({ onClose, onCreated, classes }) {
  const [form, setForm] = useState({
    national_id: '', full_name: '', guardian_name: '', guardian_phone: '', extra_phone: '',
    class_id: '', section_id: '', tuition_fee: '', registration_fee: '', uniform_required: false,
    uniform_fee: '', extra_fee: '', discount: '', notes: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }));

  const sections = classes.find((c) => String(c.id) === String(form.class_id))?.sections || [];
  const n = (v) => Math.round((Number(v) || 0) * 100);
  const total = n(form.tuition_fee) + n(form.registration_fee)
    + (form.uniform_required ? n(form.uniform_fee) : 0) + n(form.extra_fee) - n(form.discount);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const out = await api.post('/students', {
        ...form,
        class_id: form.class_id || null,
        section_id: form.section_id || null
      });
      onCreated(out.student);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal title="إضافة طالب" wide onClose={onClose} actions={
      <>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : <><Icon name="check" size={16} />حفظ الطالب</>}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      <form onSubmit={submit}>
        {error && <div className="alert bad">{error}</div>}

        <div className="grid g2">
          <div className="field">
            <label>الرقم الوطني <span className="req">*</span></label>
            <input className="input ltr" value={form.national_id} onChange={set('national_id')} required
              placeholder="0012345678901" inputMode="numeric" />
            <div className="hint">يُحفظ كنص — الأصفار في البداية محفوظة، ولا يجوز تكراره.</div>
          </div>
          <div className="field">
            <label>اسم الطالب <span className="req">*</span></label>
            <input className="input" value={form.full_name} onChange={set('full_name')} required />
          </div>
          <div className="field">
            <label>هاتف ولي الأمر</label>
            <input className="input ltr" value={form.guardian_phone} onChange={set('guardian_phone')} inputMode="tel" />
          </div>
          <div className="field">
            <label>هاتف إضافي</label>
            <input className="input ltr" value={form.extra_phone} onChange={set('extra_phone')} inputMode="tel" />
          </div>
          <div className="field">
            <label>الصف</label>
            <select className="select" value={form.class_id} onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value, section_id: '' }))}>
              <option value="">—</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
          </div>
          <div className="field">
            <label>الفصل</label>
            <select className="select" value={form.section_id} onChange={set('section_id')} disabled={!sections.length}>
              <option value="">—</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
            </select>
          </div>
        </div>

        <h4 style={{ marginTop: 6 }}>الرسوم</h4>
        <div className="grid g3">
          <div className="field">
            <label>الرسوم الدراسية</label>
            <input className="input ltr" value={form.tuition_fee} onChange={set('tuition_fee')} inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="field">
            <label>رسوم التسجيل</label>
            <input className="input ltr" value={form.registration_fee} onChange={set('registration_fee')} inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="field">
            <label>رسوم إضافية</label>
            <input className="input ltr" value={form.extra_fee} onChange={set('extra_fee')} inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="field">
            <label>الخصم</label>
            <input className="input ltr" value={form.discount} onChange={set('discount')} inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="field">
            <label>سعر الزي</label>
            <input className="input ltr" value={form.uniform_fee} onChange={set('uniform_fee')} inputMode="decimal"
              placeholder="0.00" disabled={!form.uniform_required} />
          </div>
          <div className="field">
            <label>الزي المدرسي</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, paddingTop: 8 }}>
              <input type="checkbox" checked={form.uniform_required} onChange={set('uniform_required')} />
              الزي مطلوب لهذا الطالب
            </label>
          </div>
        </div>

        <div className="field">
          <label>ملاحظات</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </div>

        <div className="alert info" style={{ marginBottom: 0 }}>
          إجمالي المستحق المحسوب: <b className="num">{money((total / 100).toFixed(2))}</b>
          <div className="hint" style={{ marginTop: 4 }}>
            المستحق والمدفوع والمتبقي يحسبها النظام تلقائيًا ولا تُكتب يدويًا. رقم الطالب يُولَّد آليًا.
          </div>
        </div>
      </form>
    </Modal>
  );
}
