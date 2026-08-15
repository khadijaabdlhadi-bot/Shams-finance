import { useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { num } from '../lib/format.js';
import { Icon, Spinner, StatusBadge, Empty } from '../components/ui.jsx';

/**
 * مسار الاستيراد: رفع ← ربط الأعمدة ← معاينة وفحص ← تأكيد ← استيراد ← تقرير.
 * لا يُحفظ أي صف في قاعدة البيانات قبل خطوة التأكيد.
 */
const STEPS = ['رفع الملف', 'ربط الأعمدة', 'المعاينة والفحص', 'التقرير'];

export default function ExcelImport() {
  const { toast } = useApp();
  const [step, setStep] = useState(0);
  const [uploaded, setUploaded] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  const loadHistory = () => api.get('/excel/imports').then(setHistory).catch(() => {});
  useEffect(loadHistory, []);

  const getTemplate = async () => {
    try {
      await download('/excel/template', 'students-template.xlsx');
      toast.ok('نُزّل النموذج الفارغ — املأه ثم ارفعه هنا.');
    } catch (err) { toast.error(err.message); }
  };

  /** تصدير الطلاب الموجودين في قاعدة البيانات — وظيفة مستقلة تمامًا عن النموذج */
  const exportStudents = async () => {
    try {
      const { count } = await api.get('/excel/students/export-count');
      if (!count) { toast.error('لا يوجد طلاب لتصديرهم بعد.'); return; }
      await download('/excel/students/export.xlsx', 'students-all.xlsx');
      toast.ok(`تم تصدير ${count} طالبًا من قاعدة البيانات.`);
    } catch (err) { toast.error(err.message); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const out = await api.upload('/excel/upload', fd);
      setUploaded(out);
      setMapping(out.mapping || {});
      setStep(1);
    } catch (err) { setError(err.message); } finally { setBusy(false); e.target.value = ''; }
  };

  const doPreview = async () => {
    setBusy(true); setError('');
    try {
      const out = await api.post('/excel/preview', { upload_id: uploaded.upload_id, mapping });
      setPreview(out);
      setStep(2);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const doImport = async () => {
    setBusy(true); setError('');
    try {
      const out = await api.post('/excel/import', {
        upload_id: uploaded.upload_id, mapping, filename: uploaded.filename
      });
      setReport(out);
      setStep(3);
      toast.ok(out.message);
      loadHistory();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const reset = () => {
    setStep(0); setUploaded(null); setMapping({}); setPreview(null); setReport(null); setError('');
  };

  return (
    <div>
      <h1>Excel — استيراد وتصدير</h1>
      <div className="alert info">
        <b>وظيفتان منفصلتان:</b> «تحميل نموذج Excel (فارغ)» لإضافة طلاب جدد،
        و«تصدير بيانات الطلاب الحاليين» لتنزيل الطلاب الموجودين فعليًا في قاعدة البيانات بأرقامهم المالية.
      </div>

      <div className="toolbar">
        {STEPS.map((label, i) => (
          <span key={label} className={`badge ${i === step ? 'info' : i < step ? 'ok' : 'grey'}`}>
            {i + 1}. {label}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={getTemplate}><Icon name="download" size={15} />تحميل نموذج Excel (فارغ)</button>
        <button className="btn btn-sm btn-primary" onClick={exportStudents}>
          <Icon name="download" size={15} />تصدير بيانات الطلاب الحاليين
        </button>
        {step > 0 && <button className="btn btn-sm btn-ghost" onClick={reset}>البدء من جديد</button>}
      </div>

      {error && <div className="alert bad">{error}</div>}
      {busy && <Spinner />}

      {step === 0 && !busy && (
        <div className="card">
          <h3>1) اختر ملف الطلاب</h3>
          <div className="alert info">
            نزّل النموذج أولًا، واملأه، ثم ارفعه هنا. الرقم الوطني وأرقام الهواتف تُقرأ كنص —
            الأصفار في البداية محفوظة ولن تُحذف.
          </div>
          <input className="input" type="file" accept=".xlsx,.xlsm" onChange={onFile} />
        </div>
      )}

      {step === 1 && uploaded && (
        <div className="card">
          <h3>2) ربط الأعمدة</h3>
          <p className="hint">
            الملف: <b>{uploaded.filename}</b> · عدد الصفوف: <b>{num(uploaded.total_rows)}</b>.
            تم الربط تلقائيًا حسب أسماء الأعمدة — عدّله إذا لزم.
          </p>
          <div className="grid g3">
            {uploaded.columns.map((c) => (
              <div className="field" key={c.key}>
                <label>{c.label} {c.required && <span className="req">*</span>}</label>
                <select className="select" value={mapping[c.key] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value }))}>
                  <option value="">— لا يوجد —</option>
                  {uploaded.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={doPreview} disabled={busy || !mapping.national_id || !mapping.full_name}>
            متابعة إلى المعاينة
          </button>
        </div>
      )}

      {step === 2 && preview && (
        <div className="card">
          <h3>3) المعاينة والفحص</h3>
          <div className="grid g4" style={{ marginBottom: 12 }}>
            <Box label="إجمالي الصفوف" value={preview.total} />
            <Box label="جاهزة للاستيراد" value={preview.counts.ready || 0} tone="ok" />
            <Box label="مكررة / موجودة" value={(preview.counts.duplicate_in_file || 0) + (preview.counts.exists || 0)} tone="warn" />
            <Box label="بها أخطاء" value={(preview.counts.error || 0) + (preview.counts.missing || 0)} tone="bad" />
          </div>

          <div className="alert warn">
            لم يُحفظ أي صف بعد. الصفوف غير الجاهزة ستُتجاوز، وستُسجَّل أسبابها في تقرير الاستيراد.
          </div>

          <div className="table-wrap" style={{ maxHeight: '52vh' }}>
            <table className="table">
              <thead><tr><th>الصف</th><th>الحالة</th><th>الرقم الوطني</th><th>الاسم</th><th>الصف الدراسي</th><th>الرسوم</th><th>الملاحظات</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row_number}>
                    <td className="num">{r.row_number}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num">{r.data.national_id || '—'}</td>
                    <td>{r.data.full_name || '—'}</td>
                    <td>{r.data.class_name || '—'}</td>
                    <td className="num">{r.data.tuition_fee}</td>
                    <td className="hint">{r.issues.join(' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-lg" onClick={doImport} disabled={busy || !preview.ready}>
              <Icon name="check" size={17} />تأكيد واستيراد {num(preview.ready)} طالبًا
            </button>
            <button className="btn" onClick={() => setStep(1)}>رجوع لربط الأعمدة</button>
          </div>
        </div>
      )}

      {step === 3 && report && (
        <div className="card">
          <h3>4) تقرير الاستيراد</h3>
          <div className="grid g4" style={{ marginBottom: 12 }}>
            <Box label="إجمالي السجلات" value={report.total} />
            <Box label="تم استيرادها" value={report.imported} tone="ok" />
            <Box label="مكررة" value={report.duplicates} tone="warn" />
            <Box label="بها أخطاء" value={report.errors} tone="bad" />
          </div>
          <div className="alert ok">{report.message} وسُجّلت العملية في سجل العمليات باسمك.</div>
          {report.rows.filter((r) => r.status !== 'imported').length > 0 && (
            <div className="table-wrap" style={{ maxHeight: '40vh' }}>
              <table className="table">
                <thead><tr><th>الصف</th><th>الحالة</th><th>السبب</th></tr></thead>
                <tbody>
                  {report.rows.filter((r) => r.status !== 'imported').map((r) => (
                    <tr key={r.row_number}>
                      <td className="num">{r.row_number}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="hint">{r.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={reset}>استيراد ملف آخر</button>
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h3>عمليات الاستيراد السابقة</h3>
        {history.length === 0 && <Empty title="لا توجد عمليات سابقة" />}
        {history.length > 0 && (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead><tr><th>الملف</th><th>الإجمالي</th><th>مستورد</th><th>مكرر</th><th>أخطاء</th><th>المنفّذ</th><th>التاريخ</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.filename}</td>
                    <td className="num">{h.total_rows}</td>
                    <td className="num">{h.imported}</td>
                    <td className="num">{h.duplicates}</td>
                    <td className="num">{h.errors}</td>
                    <td className="hint">{h.created_by_name}</td>
                    <td className="num hint">{new Date(h.created_at).toLocaleString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const Box = ({ label, value, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="label">{label}</div>
    <div className="value num">{num(value)}</div>
  </div>
);
