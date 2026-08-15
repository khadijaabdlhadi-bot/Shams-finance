import { useState } from 'react';
import { api, token } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { dateTime } from '../lib/format.js';
import { Icon } from '../components/ui.jsx';

/**
 * حسابي — يغيّر المستخدم اسمه وكلمة مروره بنفسه.
 * كل تغيير يتطلب كلمة المرور الحالية، ويُسجَّل في سجل العمليات.
 */
export default function Account() {
  const { user, setUser, toast } = useApp();

  return (
    <div style={{ maxWidth: 760 }}>
      <h1>حسابي</h1>

      <div className="card">
        <h3>بياناتي</h3>
        <div className="kv">
          <dt>الاسم</dt><dd>{user.full_name}</dd>
          <dt>اسم المستخدم</dt><dd className="num">{user.username}</dd>
          <dt>الدور</dt><dd>{user.role_name}</dd>
          <dt>آخر دخول</dt><dd className="num">{user.last_login_at ? dateTime(user.last_login_at) : 'أول دخول'}</dd>
        </div>
      </div>

      {user.must_change_password && (
        <div className="alert warn">
          كلمة مرورك الحالية أنشأها مدير النظام. يُنصح بتغييرها الآن حتى لا يعرفها أحد غيرك.
        </div>
      )}

      <ChangePassword onDone={(out) => { token.set(out.token); setUser(out.user); toast.ok(out.message); }} />
      <ChangeUsername current={user.username}
        onDone={(out) => { token.set(out.token); setUser(out.user); toast.ok(out.message); }} />
      <ChangeProfile user={user} onDone={(out) => { setUser(out.user); toast.ok(out.message); }} />
    </div>
  );
}

/* ---------------- كلمة المرور ---------------- */

export function ChangePassword({ onDone, forced = false }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const weak = form.new_password.length > 0 && form.new_password.length < 8;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.new_password;
  const ready = form.current_password && form.new_password.length >= 8 && form.confirm === form.new_password;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const out = await api.post('/auth/change-password', {
        current_password: form.current_password, new_password: form.new_password
      });
      setForm({ current_password: '', new_password: '', confirm: '' });
      onDone(out);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3><Icon name="shield" size={17} />تغيير كلمة المرور</h3>
      {error && <div className="alert bad">{error}</div>}

      <div className="field">
        <label>كلمة المرور الحالية <span className="req">*</span></label>
        <input className="input ltr" type="password" value={form.current_password}
          onChange={set('current_password')} autoComplete="current-password" />
      </div>
      <div className="grid g2">
        <div className="field">
          <label>كلمة المرور الجديدة <span className="req">*</span></label>
          <input className="input ltr" type="password" value={form.new_password}
            onChange={set('new_password')} autoComplete="new-password" />
          {weak && <div className="error-text">8 أحرف على الأقل.</div>}
        </div>
        <div className="field">
          <label>تأكيد كلمة المرور <span className="req">*</span></label>
          <input className="input ltr" type="password" value={form.confirm}
            onChange={set('confirm')} autoComplete="new-password" />
          {mismatch && <div className="error-text">الكلمتان غير متطابقتين.</div>}
        </div>
      </div>

      <button className="btn btn-primary" disabled={!ready || busy}>
        {busy ? 'جارٍ الحفظ…' : <><Icon name="check" size={16} />حفظ كلمة المرور</>}
      </button>
      {!forced && (
        <p className="hint" style={{ marginTop: 8 }}>
          تُخزَّن مشفّرة (bcrypt) ولا يستطيع أحد قراءتها — حتى مدير النظام يستطيع تعيين كلمة جديدة فقط، لا رؤية القديمة.
        </p>
      )}
    </form>
  );
}

/* ---------------- اسم المستخدم ---------------- */

function ChangeUsername({ current, onDone }) {
  const [form, setForm] = useState({ new_username: current, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const changed = form.new_username.trim() && form.new_username.trim().toLowerCase() !== String(current).toLowerCase();
  const valid = /^[A-Za-z0-9._@-]{3,60}$/.test(form.new_username.trim());
  const ready = changed && valid && form.password;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const out = await api.post('/auth/change-username', {
        new_username: form.new_username.trim(), password: form.password
      });
      setForm({ new_username: out.user.username, password: '' });
      onDone(out);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3><Icon name="users" size={17} />تغيير اسم المستخدم</h3>
      {error && <div className="alert bad">{error}</div>}

      <div className="grid g2">
        <div className="field">
          <label>اسم المستخدم الجديد <span className="req">*</span></label>
          <input className="input ltr" value={form.new_username} onChange={set('new_username')} autoComplete="username" />
          {form.new_username && !valid && (
            <div className="error-text">حروف إنجليزية وأرقام ونقطة وشرطة فقط، و3 أحرف على الأقل.</div>
          )}
        </div>
        <div className="field">
          <label>كلمة المرور الحالية <span className="req">*</span></label>
          <input className="input ltr" type="password" value={form.password} onChange={set('password')}
            autoComplete="current-password" />
        </div>
      </div>

      <button className="btn btn-primary" disabled={!ready || busy}>
        {busy ? 'جارٍ الحفظ…' : <><Icon name="check" size={16} />حفظ اسم المستخدم</>}
      </button>
      <p className="hint" style={{ marginTop: 8 }}>
        الاسم القديم يبقى محفوظًا في سجل العمليات، فلا يضيع أثر من نفّذ العمليات السابقة.
      </p>
    </form>
  );
}

/* ---------------- الاسم والبريد ---------------- */

function ChangeProfile({ user, onDone }) {
  const [form, setForm] = useState({ full_name: user.full_name, email: user.email || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onDone(await api.patch('/auth/profile', form)); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3><Icon name="edit" size={17} />الاسم والبريد</h3>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid g2">
        <div className="field">
          <label>الاسم الكامل <span className="req">*</span></label>
          <input className="input" value={form.full_name} onChange={set('full_name')} />
          <div className="hint">هذا الاسم يظهر في الإيصالات وسجل العمليات.</div>
        </div>
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input className="input ltr" value={form.email} onChange={set('email')} />
        </div>
      </div>
      <button className="btn" disabled={busy || !form.full_name.trim()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
    </form>
  );
}
