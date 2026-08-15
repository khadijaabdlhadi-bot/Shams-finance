import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { Link } from 'react-router-dom';
import { Icon, Spinner, ErrorBox } from '../components/ui.jsx';

const LABELS = {
  school_name: 'اسم المدرسة', school_name_en: 'الاسم بالإنجليزية', school_short: 'الاختصار',
  school_address: 'العنوان', school_phone: 'الهاتف', logo_path: 'مسار الشعار',
  currency: 'رمز العملة', currency_code: 'رمز العملة الدولي', timezone: 'المنطقة الزمنية',
  receipt_prefix: 'بادئة رقم الإيصال', student_prefix: 'بادئة رقم الطالب',
  receipt_footer: 'نص أسفل الإيصال', date_format: 'صيغة التاريخ'
};

export default function Settings() {
  const { toast, reloadSettings } = useApp();
  const [values, setValues] = useState(null);
  const [years, setYears] = useState([]);
  const [classes, setClasses] = useState([]);
  const [methods, setMethods] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [newMethod, setNewMethod] = useState({ code: '', name_ar: '' });
  const [newClass, setNewClass] = useState('');

  const load = () => {
    setError(null);
    api.get('/settings').then(setValues).catch(setError);
    api.get('/settings/academic-years').then(setYears).catch(() => {});
    api.get('/settings/classes').then(setClasses).catch(() => {});
    api.get('/settings/payment-methods').then(setMethods).catch(() => {});
  };
  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!values) return <Spinner />;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', values);
      await reloadSettings();
      toast.ok('تم حفظ الإعدادات.');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const addYear = async () => {
    try {
      await api.post('/settings/academic-years', { name: newYear });
      setNewYear(''); load(); toast.ok('تمت إضافة السنة الدراسية.');
    } catch (err) { toast.error(err.message); }
  };

  const setCurrent = async (id) => {
    try { await api.post(`/settings/academic-years/${id}/set-current`); load(); toast.ok('تم تعيين السنة الحالية.'); }
    catch (err) { toast.error(err.message); }
  };

  const addMethod = async () => {
    try {
      await api.post('/settings/payment-methods', newMethod);
      setNewMethod({ code: '', name_ar: '' }); load(); toast.ok('تمت إضافة طريقة الدفع.');
    } catch (err) { toast.error(err.message); }
  };

  const addClass = async () => {
    try {
      await api.post('/settings/classes', { name_ar: newClass });
      setNewClass(''); load(); toast.ok('تمت إضافة الصف.');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <h1>الإعدادات</h1>

      <div className="card">
        <div className="card-head">
          <h3>حسابي الشخصي</h3>
          <Link className="btn btn-sm" to="/account"><Icon name="shield" size={15} />تغيير اسم المستخدم وكلمة المرور</Link>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          كل مستخدم يغيّر اسمه وكلمة مروره بنفسه من صفحة «حسابي»، ويحتاج كلمة مروره الحالية للتأكيد.
          ولمدير النظام تعيين كلمة مرور جديدة أو تغيير اسم أي مستخدم من صفحة «المستخدمون والصلاحيات».
        </p>
      </div>

      <div className="card">
        <h3>بيانات المدرسة والإيصالات</h3>
        <div className="grid g2">
          {Object.entries(values).map(([k, v]) => (
            <div className="field" key={k}>
              <label>{LABELS[k] || k}</label>
              <input className="input" value={v ?? ''} onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          <Icon name="check" size={16} />{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
        <p className="hint" style={{ marginTop: 8 }}>
          العملة وبادئات الترقيم غير مثبّتة في الكود — تُقرأ من هنا. تغيير البادئة يؤثر على الأرقام الجديدة فقط.
        </p>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>السنوات الدراسية</h3>
          <div className="rows">
            {years.map((y) => (
              <div key={y.id} className="row">
                <span className="name">{y.name}</span>
                {y.is_current
                  ? <span className="badge ok">السنة الحالية</span>
                  : <button className="btn btn-sm" onClick={() => setCurrent(y.id)}>تعيينها الحالية</button>}
              </div>
            ))}
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <input className="input ltr grow" placeholder="2027/2028" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
            <button className="btn btn-primary" onClick={addYear} disabled={!/^\d{4}\/\d{4}$/.test(newYear)}>إضافة</button>
          </div>
          <p className="hint">لكل سنة حساباتها وطلابها المسجّلون فيها — لا تختلط الأرقام بين السنوات.</p>
        </div>

        <div className="card">
          <h3>طرق الدفع</h3>
          <div className="rows">
            {methods.map((m) => (
              <div key={m.id} className="row">
                <span className="name">{m.name_ar} <span className="hint">({m.code})</span></span>
                <span className="badge ok">مفعّلة</span>
              </div>
            ))}
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <input className="input ltr" style={{ width: 130 }} placeholder="code" value={newMethod.code}
              onChange={(e) => setNewMethod((m) => ({ ...m, code: e.target.value }))} />
            <input className="input grow" placeholder="الاسم بالعربية" value={newMethod.name_ar}
              onChange={(e) => setNewMethod((m) => ({ ...m, name_ar: e.target.value }))} />
            <button className="btn btn-primary" onClick={addMethod} disabled={!newMethod.code || !newMethod.name_ar}>إضافة</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>الصفوف والفصول</h3>
        <div className="grid g3">
          {classes.map((c) => (
            <div key={c.id} className="stat">
              <div className="label">{c.name_ar}</div>
              <div className="hint">الفصول: {c.sections.map((s) => s.name_ar).join('، ') || '—'}</div>
            </div>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input className="input grow" placeholder="اسم صف جديد" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
          <button className="btn btn-primary" onClick={addClass} disabled={!newClass.trim()}>إضافة صف</button>
        </div>
      </div>
    </div>
  );
}
