import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { dateTime } from '../lib/format.js';
import { Icon, Spinner, Modal, Confirm, ErrorBox } from '../components/ui.jsx';

export default function Users() {
  const { toast, user: me } = useApp();
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [disabling, setDisabling] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api.get('/users').then(setUsers).catch(setError);
    api.get('/users/roles').then(setRoles).catch(() => {});
  };
  useEffect(load, []);

  const toggleActive = async (u, active) => {
    setBusy(true);
    try {
      await api.patch(`/users/${u.id}`, { active });
      toast.ok(active ? 'تم تفعيل الحساب.' : 'تم تعطيل الحساب.');
      setDisabling(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!users || !roles) return <Spinner />;

  return (
    <div>
      <div className="card-head">
        <h1 style={{ margin: 0 }}>المستخدمون والصلاحيات</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />مستخدم جديد</button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th>أُنشئ في</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name}</b>{u.id === me.id && <span className="badge info" style={{ marginInlineStart: 6 }}>أنت</span>}</td>
                <td className="num">{u.username}</td>
                <td><span className="badge grey">{u.role_name}</span></td>
                <td><span className={`badge ${u.active ? 'ok' : 'bad'}`}>{u.active ? 'مفعّل' : 'معطّل'}</span></td>
                <td className="num hint">{u.last_login_at ? dateTime(u.last_login_at) : 'لم يدخل بعد'}</td>
                <td className="num hint">{dateTime(u.created_at)}</td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => setEditing(u)}><Icon name="edit" size={14} />تعديل</button>
                  {u.active
                    ? <button className="btn btn-sm btn-danger" disabled={u.id === me.id} onClick={() => setDisabling(u)}>تعطيل</button>
                    : <button className="btn btn-sm btn-ok" onClick={() => toggleActive(u, true)}>تفعيل</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>الأدوار والصلاحيات</h3>
        <p className="hint">التحقق من الصلاحيات يتم في الخادم قبل كل عملية — إخفاء الأزرار في الواجهة ليس حماية بحد ذاته.</p>
        <RolesEditor roles={roles} onSaved={load} toast={toast} />
      </div>

      {creating && <UserForm roles={roles.roles} onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); load(); toast.ok('تم إنشاء المستخدم.'); }} />}
      {editing && <UserForm user={editing} roles={roles.roles} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); toast.ok('تم حفظ التعديلات.'); }} />}
      {disabling && (
        <Confirm title="تعطيل المستخدم" danger busy={busy}
          message={`سيُمنع «${disabling.full_name}» من الدخول. لن يُحذف الحساب ولا سجل عملياته.`}
          confirmText="تعطيل" onConfirm={() => toggleActive(disabling, false)} onClose={() => setDisabling(null)} />
      )}
    </div>
  );
}

function UserForm({ user, roles, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: user?.full_name || '', username: user?.username || '', email: user?.email || '',
    // الافتراضي هو أقل الأدوار صلاحية (إدخال بيانات) — لا يُمنح دور المدير بالخطأ
    password: '', role_id: String(user?.role_id || roles.find((r) => r.code === 'data_entry')?.id || roles[0]?.id || '')
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (user) {
        const patch = { full_name: form.full_name, email: form.email, role_id: Number(form.role_id) };
        if (form.username && form.username !== user.username) patch.username = form.username;
        if (form.password) patch.password = form.password;
        await api.patch(`/users/${user.id}`, patch);
      } else {
        await api.post('/users', { ...form, role_id: Number(form.role_id) });
      }
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={user ? `تعديل: ${user.full_name}` : 'مستخدم جديد'} onClose={onClose} actions={
      <>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      {error && <div className="alert bad">{error}</div>}
      <div className="field"><label>الاسم الكامل <span className="req">*</span></label>
        <input className="input" value={form.full_name} onChange={set('full_name')} /></div>
      <div className="field"><label>اسم المستخدم <span className="req">*</span></label>
        <input className="input ltr" value={form.username} onChange={set('username')} autoComplete="off" />
        {user && <div className="hint">تغييره يعني أن هذا المستخدم سيدخل بالاسم الجديد. الاسم القديم يبقى في سجل العمليات.</div>}
      </div>
      <div className="field"><label>البريد الإلكتروني</label>
        <input className="input ltr" value={form.email} onChange={set('email')} /></div>
      <div className="field"><label>الدور <span className="req">*</span></label>
        <select className="select" value={form.role_id} onChange={set('role_id')}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
        </select></div>
      <div className="field">
        <label>{user ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور'} {!user && <span className="req">*</span>}</label>
        <input className="input ltr" type="password" value={form.password} onChange={set('password')} />
        <div className="hint">8 أحرف على الأقل. تُخزَّن مشفّرة (bcrypt) ولا يمكن لأحد قراءتها.</div>
      </div>
    </Modal>
  );
}

function RolesEditor({ roles, onSaved, toast }) {
  const [openRole, setOpenRole] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const open = (role) => { setOpenRole(role); setSelected(role.permissions || []); };

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/users/roles/${openRole.id}/permissions`, { permissions: selected });
      toast.ok('تم تحديث صلاحيات الدور.');
      setOpenRole(null);
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const groups = roles.permissions.reduce((acc, p) => {
    (acc[p.group_ar] = acc[p.group_ar] || []).push(p);
    return acc;
  }, {});

  return (
    <>
      <div className="rows">
        {roles.roles.map((r) => (
          <div key={r.id} className="row">
            <span className="name">{r.name_ar} <span className="hint">({r.permissions.length} صلاحية)</span></span>
            {r.code === 'admin'
              ? <span className="badge info">كل الصلاحيات</span>
              : <button className="btn btn-sm" onClick={() => open(r)}><Icon name="shield" size={14} />تعديل الصلاحيات</button>}
          </div>
        ))}
      </div>

      {openRole && (
        <Modal title={`صلاحيات: ${openRole.name_ar}`} wide onClose={() => setOpenRole(null)} actions={
          <>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button>
            <button className="btn" onClick={() => setOpenRole(null)} disabled={busy}>إلغاء</button>
          </>
        }>
          {Object.entries(groups).map(([group, perms]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <h4>{group}</h4>
              <div className="grid g2">
                {perms.map((p) => (
                  <label key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                    <input type="checkbox" checked={selected.includes(p.code)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.code] : s.filter((x) => x !== p.code)))} />
                    {p.name_ar}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
