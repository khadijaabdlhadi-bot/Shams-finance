import { useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { dateTime, num } from '../lib/format.js';
import { Icon, Spinner, Modal, Confirm, ErrorBox, Empty } from '../components/ui.jsx';

const sizeOf = (b) => (!b ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.round(b / 1024)} ك.ب`);
const KIND = { manual: 'يدوية', auto: 'تلقائية', pre_restore: 'قبل الاسترجاع' };

export default function Backup() {
  const { toast, can } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [restore, setRestore] = useState(null);
  const [result, setResult] = useState(null);

  const load = () => { setError(null); api.get('/backup').then(setData).catch(setError); };
  useEffect(load, []);

  // زر واحد: ينشئ النسخة ثم ينزّلها مباشرة — الطريقة الموصى بها عند تغيير الجهاز
  const exportForMove = async () => {
    setBusy(true);
    try {
      const out = await api.post('/backup');
      await download(`/backup/${out.backup.id}/download`, out.backup.filename);
      toast.ok('جاهز — احفظ الملف على فلاشة ثم استرجعه على الجهاز الجديد.');
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const createNow = async () => {
    setBusy(true);
    try {
      const out = await api.post('/backup');
      toast.ok(out.message);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/backup/${deleting.id}`);
      toast.ok('تم حذف النسخة.');
      setDeleting(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const inspect = async ({ file, filename }) => {
    setBusy(true);
    try {
      let out;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        out = await api.upload('/backup/inspect', fd);
      } else {
        out = await api.post('/backup/inspect', { filename });
      }
      setRestore(out);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Spinner />;

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>النسخ الاحتياطي والاسترجاع</h1>
        <button className="btn btn-primary" onClick={createNow} disabled={busy}>
          <Icon name="save" size={16} />{busy ? 'جارٍ الإنشاء…' : 'إنشاء نسخة الآن'}
        </button>
      </div>

      <div className="grid g4">
        <Box label="الطلاب" value={data.counts.students} />
        <Box label="الدفعات" value={data.counts.payments} />
        <Box label="الإيصالات" value={data.counts.receipts} />
        <Box label="سجل العمليات" value={data.counts.audit_logs} />
      </div>

      <div className="alert info" style={{ marginTop: 14 }}>
        النسخة ملف واحد يحتوي قاعدة البيانات كاملة + الملفات المرفوعة + ملف وصف للتحقق.
        النسخ التلقائي: <b>{data.auto === 'off' ? 'متوقف' : data.auto === 'weekly' ? 'أسبوعي' : 'يومي'}</b> ·
        يُحتفظ بآخر <b>{data.keep}</b> نسخة · مكان الحفظ على الخادم: <code>{data.directory}</code>
      </div>

      {/* نقل النظام إلى جهاز آخر — بزر واحد */}
      <div className="card">
        <h3><Icon name="save" size={17} />نقل النظام إلى جهاز آخر</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          ملف واحد ينقل <b>كل شيء</b>: الطلاب والأرقام الوطنية بأصفارها، الرسوم والخصومات، الدفعات
          والإيصالات بأرقامها، الأقساط، المستخدمين وكلمات مرورهم وصلاحياتهم، الإعدادات، الشعار،
          سجل العمليات، وعدّادات الترقيم حتى لا يتكرر رقم إيصال بعد النقل.
        </p>
        <ol className="hint" style={{ margin: '0 0 12px', paddingInlineStart: 18, lineHeight: 2 }}>
          <li>على الجهاز <b>القديم</b>: اضغط الزر أدناه — يُنشئ الملف ويُنزّله على الفلاشة.</li>
          <li>على الجهاز <b>الجديد</b>: ثبّت النظام وشغّله (دليل التثبيت)، وادخل كمدير.</li>
          <li>من هذه الصفحة: <b>الاسترجاع من ملف خارجي</b> ← اختر الملف ← تأكيد.</li>
          <li>سجّل الدخول ببيانات الجهاز القديم — كل شيء موجود.</li>
        </ol>
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={exportForMove}>
          <Icon name="download" size={17} />{busy ? 'جارٍ التجهيز…' : 'تجهيز ملف النقل وتنزيله'}
        </button>
      </div>

      <div className="card">
        <h3>النسخ المتاحة</h3>
        {data.backups.length === 0 && <Empty title="لا توجد نسخ بعد" hint="اضغط «إنشاء نسخة الآن»." />}
        {data.backups.length > 0 && (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead><tr><th>الملف</th><th>النوع</th><th>الحجم</th><th>الحالة</th><th>المنفّذ</th><th>التاريخ</th><th></th></tr></thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.id}>
                    <td className="num" style={{ fontSize: '.78rem' }}>{b.filename}</td>
                    <td><span className="badge grey">{KIND[b.kind] || b.kind}</span></td>
                    <td className="num">{sizeOf(b.size_bytes)}</td>
                    <td><span className={`badge ${b.status === 'success' ? 'ok' : 'bad'}`}>{b.status === 'success' ? 'ناجحة' : 'فاشلة'}</span></td>
                    <td className="hint">{b.created_by_name || 'النظام'}</td>
                    <td className="num hint">{dateTime(b.created_at)}</td>
                    <td className="actions">
                      {b.exists && (
                        <>
                          <button className="btn btn-sm" onClick={() => download(`/backup/${b.id}/download`, b.filename).catch((e) => toast.error(e.message))}>
                            <Icon name="download" size={14} />تنزيل
                          </button>
                          {can('backup.restore') && (
                            <button className="btn btn-sm btn-danger" onClick={() => inspect({ filename: b.filename })}>استرجاع</button>
                          )}
                        </>
                      )}
                      <button className="btn btn-sm btn-ghost" onClick={() => setDeleting(b)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {can('backup.restore') && (
        <div className="card">
          <h3>الاسترجاع من ملف خارجي</h3>
          <div className="alert warn">
            استخدم هذا عند نقل النظام إلى كمبيوتر جديد: ارفع ملف النسخة من الجهاز القديم، وسيفحصه النظام قبل التنفيذ.
          </div>
          <input className="input" type="file" accept=".zip"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) inspect({ file: f }); e.target.value = ''; }} />
        </div>
      )}

      {data.restore_log?.length > 0 && (
        <div className="card">
          <h3>سجل عمليات الاسترجاع</h3>
          <p className="hint">يُحفظ خارج قاعدة البيانات حتى لا يضيع عند الاسترجاع.</p>
          <div className="rows">
            {data.restore_log.map((r, i) => (
              <div key={i} className="row">
                <span className="name">{r.file}</span>
                <span className="hint">{r.by} · {dateTime(r.at)}</span>
                <span className={`badge ${r.result === 'success' ? 'ok' : 'warn'}`}>{r.result === 'success' ? 'ناجحة' : 'تحقق جزئي'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleting && (
        <Confirm title="حذف النسخة" danger busy={busy}
          message={`سيُحذف الملف «${deleting.filename}» نهائيًا من القرص.`}
          confirmText="حذف" onConfirm={remove} onClose={() => setDeleting(null)} />
      )}

      {restore && !result && (
        <RestoreModal info={restore} onClose={() => setRestore(null)}
          onDone={(res) => { setResult(res); setRestore(null); load(); }} toast={toast} />
      )}

      {result && (
        <Modal title="نتيجة الاسترجاع" onClose={() => { setResult(null); window.location.reload(); }} actions={
          <button className="btn btn-primary" onClick={() => window.location.reload()}>تحديث النظام</button>
        }>
          <div className={`alert ${result.ok ? 'ok' : 'warn'}`}>{result.message}</div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead><tr><th>العنصر</th><th>المتوقع</th><th>الموجود</th><th>النتيجة</th></tr></thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.key}>
                    <td>{LABELS[c.key] || c.key}</td>
                    <td className="num">{c.expected ?? '—'}</td>
                    <td className="num">{c.actual}</td>
                    <td><span className={`badge ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'مطابق' : 'غير مطابق'}</span></td>
                  </tr>
                ))}
                <tr>
                  <td>إجمالي المحصّل</td>
                  <td className="num">{result.balance_check.expected ?? '—'}</td>
                  <td className="num">{result.balance_check.actual}</td>
                  <td><span className={`badge ${result.balance_check.ok ? 'ok' : 'bad'}`}>{result.balance_check.ok ? 'مطابق' : 'غير مطابق'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">نسخة الأمان قبل الاسترجاع: {result.safety_backup}</p>
        </Modal>
      )}
    </div>
  );
}

const LABELS = { students: 'الطلاب', payments: 'الدفعات', receipts: 'الإيصالات', users: 'المستخدمون', audit_logs: 'سجل العمليات' };
const Box = ({ label, value }) => (
  <div className="stat"><div className="label">{label}</div><div className="value num">{num(value)}</div></div>
);

function RestoreModal({ info, onClose, onDone, toast }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try {
      const out = await api.post('/backup/restore', {
        token: info.token, filename: info.filename, confirm, password
      });
      toast.ok(out.message);
      onDone(out);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const m = info.manifest;
  return (
    <Modal title="استرجاع نسخة احتياطية" onClose={onClose} actions={
      <>
        <button className="btn btn-danger" disabled={busy || confirm.trim() !== 'استرجاع' || !password} onClick={run}>
          {busy ? 'جارٍ الاسترجاع…' : 'تنفيذ الاسترجاع'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      <div className="alert bad">{info.warning}</div>
      {error && <div className="alert bad">{error}</div>}

      <h4>محتوى النسخة</h4>
      <div className="kv" style={{ marginBottom: 12 }}>
        <dt>الملف</dt><dd className="num" style={{ fontSize: '.8rem' }}>{info.filename}</dd>
        <dt>تاريخ النسخة</dt><dd className="num">{dateTime(m.created_at)}</dd>
        <dt>أخذها</dt><dd>{m.created_by?.name || '—'}</dd>
        <dt>إصدار النظام</dt><dd className="num">{m.app_version} (مخطط {m.schema_version})</dd>
        <dt>البصمة SHA-256</dt><dd className="num" style={{ fontSize: '.7rem', wordBreak: 'break-all' }}>{info.sha256}</dd>
      </div>

      <div className="table-wrap" style={{ border: 'none', marginBottom: 12 }}>
        <table className="table">
          <thead><tr><th>العنصر</th><th>داخل النسخة</th><th>الحالي الآن</th></tr></thead>
          <tbody>
            {Object.keys(LABELS).map((k) => (
              <tr key={k}>
                <td>{LABELS[k]}</td>
                <td className="num">{m.counts?.[k] ?? '—'}</td>
                <td className="num">{info.current?.[k] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="field">
        <label>كلمة مرورك للتأكيد <span className="req">*</span></label>
        <input className="input ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="field">
        <label>اكتب كلمة «استرجاع» للتأكيد <span className="req">*</span></label>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
    </Modal>
  );
}
