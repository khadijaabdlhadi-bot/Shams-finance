import { useState } from 'react';
import { useApp } from '../App.jsx';
import { Icon } from '../components/ui.jsx';

export default function Login() {
  const { signIn, settings } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err.message || 'تعذّر تسجيل الدخول.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        {settings?.logo_path
          ? <img className="logo" src={settings.logo_path} alt="" />
          : <div className="logo" style={{ display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 18, fontWeight: 800 }}>S.H.S</div>}
        <h1 style={{ textAlign: 'center', marginBottom: 2 }}>{settings?.school_name || 'مدرسة شمس الوطن'}</h1>
        <p style={{ textAlign: 'center', color: 'var(--ink-2)', fontWeight: 600 }}>المنظومة المالية</p>

        <div className="field">
          <label>اسم المستخدم</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="username" autoFocus required />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required />
        </div>

        {error && <div className="alert bad">{error}</div>}

        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'جارٍ الدخول…' : <><Icon name="check" size={17} />دخول</>}
        </button>
        <p className="hint" style={{ textAlign: 'center', marginTop: 12 }}>
          الدخول متاح لموظفي المدرسة المصرّح لهم فقط، وكل عملية تُسجَّل باسم منفّذها.
        </p>
      </form>
    </div>
  );
}
