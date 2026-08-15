import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api, token } from './lib/api.js';
import { setCurrency } from './lib/format.js';
import { Icon, Spinner, ToastProvider, useToast } from './components/ui.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Students from './pages/Students.jsx';
import StudentProfile from './pages/StudentProfile.jsx';
import NewPayment from './pages/NewPayment.jsx';
import Payments from './pages/Payments.jsx';
import Receipts from './pages/Receipts.jsx';
import FeeScreen from './pages/FeeScreen.jsx';
import Reports from './pages/Reports.jsx';
import ExcelImport from './pages/ExcelImport.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Users from './pages/Users.jsx';
import Backup from './pages/Backup.jsx';
import Settings from './pages/Settings.jsx';
import Finance from './pages/Finance.jsx';
import FinanceStudents from './pages/FinanceStudents.jsx';
import InstallmentsAll from './pages/InstallmentsAll.jsx';
import Treasury from './pages/Treasury.jsx';
import Debts from './pages/Debts.jsx';
import Discounts from './pages/Discounts.jsx';
import PaymentMethods from './pages/PaymentMethods.jsx';
import Account, { ChangePassword } from './pages/Account.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const NAV = [
  ['الرئيسية', [
    ['/', 'dashboard', 'لوحة التحكم', null]
  ]],
  ['المالية', [
    ['/finance', 'cash', 'لوحة المالية', 'payments.view'],
    ['/finance/students', 'users', 'الطلبة والمدفوعات', 'payments.view'],
    ['/pay', 'plus', 'تسجيل دفعة', 'payments.create'],
    ['/finance/installments', 'calendar', 'الأقساط', 'fees.view'],
    ['/finance/treasury', 'save', 'الخزينة', 'payments.view'],
    ['/finance/debts', 'warn', 'ديون الطلبة', 'payments.view'],
    ['/finance/discounts', 'badge', 'الخصومات', 'fees.view'],
    ['/finance/methods', 'list', 'طرق الدفع', null],
    ['/reports', 'chart', 'التقارير المالية', 'reports.view']
  ]],
  ['الطلاب والرسوم', [
    ['/students', 'users', 'الطلاب', 'students.view'],
    ['/payments', 'list', 'جميع الدفعات', 'payments.view'],
    ['/receipts', 'receipt', 'الإيصالات', 'payments.view'],
    ['/fees/registration', 'badge', 'رسوم التسجيل', 'fees.view'],
    ['/fees/uniform', 'shirt', 'الزي المدرسي', 'fees.view'],
    ['/import', 'upload', 'استيراد وتصدير Excel', 'excel.import']
  ]],
  ['النظام', [
    ['/audit', 'history', 'سجل العمليات', 'audit.view'],
    ['/users', 'shield', 'المستخدمون والصلاحيات', 'users.manage'],
    ['/backup', 'save', 'النسخ الاحتياطي', 'backup.manage'],
    ['/settings', 'gear', 'الإعدادات', 'settings.manage']
  ]]
];

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [booting, setBooting] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get('/settings/public');
      setSettings(s);
      setCurrency(s.currency);
    } catch { /* الخادم غير متاح بعد */ }
  }, []);

  useEffect(() => {
    (async () => {
      await loadSettings();
      if (token.get()) {
        try { const { user: u } = await api.get('/auth/me'); setUser(u); }
        catch { token.clear(); }
      }
      setBooting(false);
    })();
  }, [loadSettings]);

  useEffect(() => {
    const onLogout = () => { setUser(null); navigate('/login'); };
    window.addEventListener('shams:logout', onLogout);
    return () => window.removeEventListener('shams:logout', onLogout);
  }, [navigate]);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const signIn = async (username, password) => {
    const out = await api.post('/auth/login', { username, password });
    token.set(out.token);
    setUser(out.user);
    return out.user;
  };

  const signOut = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    token.clear();
    setUser(null);
    navigate('/login');
  };

  const can = (code) => !code || (user?.permissions || []).includes(code);
  const ctx = { user, setUser, settings, reloadSettings: loadSettings, signIn, signOut, can, toast };

  if (booting) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner /></div>;

  if (!user) {
    return (
      <AppCtx.Provider value={ctx}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppCtx.Provider>
    );
  }

  const groups = NAV
    .map(([group, items]) => [group, items.filter(([, , , perm]) => can(perm))])
    .filter(([, items]) => items.length);

  // أول دخول بكلمة مرور أنشأها مدير النظام: لا يُستخدم النظام قبل تغييرها
  if (user.must_change_password) {
    return (
      <div className="login-wrap">
        <div style={{ width: 'min(560px, 100%)' }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>مرحبًا {user.full_name}</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              كلمة مرورك الحالية أنشأها مدير النظام. لحماية حسابك، غيّرها الآن قبل استخدام المنظومة.
            </p>
          </div>
          <ChangePassword forced onDone={(out) => { token.set(out.token); setUser(out.user); toast.ok(out.message); }} />
          <div className="center" style={{ textAlign: 'center', marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={signOut}>تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="brand">
            {settings?.logo_path
              ? <img src={settings.logo_path} alt="" />
              : <div style={{ width: 38, height: 38, borderRadius: 8, background: '#fff', color: 'var(--brand)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>S.H.S</div>}
            <div>
              <b>{settings?.school_name || 'مدرسة شمس الوطن'}</b>
              <span>المنظومة المالية</span>
            </div>
          </div>
          <nav>
            {groups.map(([group, items]) => (
              <div key={group} className="nav-group">
                <span className="nav-title">{group}</span>
                {items.map(([to, icon, label]) => (
                  <NavLink key={to} to={to} end={to === '/' || to === '/finance'}>
                    <Icon name={icon} size={17} />{label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="foot">الإصدار 1.0.0</div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="btn btn-ghost btn-sm burger" onClick={() => setMenuOpen((o) => !o)} aria-label="القائمة">
              <Icon name="menu" size={18} />
            </button>
            <NavLink to="/account" className="who" style={{ color: 'inherit' }} title="حسابي">
              <b>{user.full_name}</b>
              <span>{user.role_name} · {user.username}</span>
            </NavLink>
            <div className="spacer" />
            <NavLink to="/account" className="btn btn-sm"><Icon name="shield" size={15} />حسابي</NavLink>
            <button className="btn btn-sm" onClick={signOut}><Icon name="logout" size={15} />خروج</button>
          </header>

          <main className="content">
            <Routes>
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/students" element={<Guard perm="students.view"><Students /></Guard>} />
              <Route path="/students/:id" element={<Guard perm="students.view"><StudentProfile /></Guard>} />
              <Route path="/pay" element={<Guard perm="payments.create"><NewPayment /></Guard>} />
              <Route path="/pay/:studentId" element={<Guard perm="payments.create"><NewPayment /></Guard>} />
              <Route path="/payments" element={<Guard perm="payments.view"><Payments /></Guard>} />
              <Route path="/receipts" element={<Guard perm="payments.view"><Receipts /></Guard>} />
              <Route path="/fees/:code" element={<Guard perm="fees.view"><FeeScreen /></Guard>} />
              <Route path="/installments" element={<Guard perm="fees.view"><InstallmentsAll /></Guard>} />
              <Route path="/finance" element={<Guard perm="payments.view"><Finance /></Guard>} />
              <Route path="/finance/students" element={<Guard perm="payments.view"><FinanceStudents /></Guard>} />
              <Route path="/finance/installments" element={<Guard perm="fees.view"><InstallmentsAll /></Guard>} />
              <Route path="/finance/treasury" element={<Guard perm="payments.view"><Treasury /></Guard>} />
              <Route path="/finance/debts" element={<Guard perm="payments.view"><Debts /></Guard>} />
              <Route path="/finance/discounts" element={<Guard perm="fees.view"><Discounts /></Guard>} />
              <Route path="/finance/methods" element={<PaymentMethods />} />
              <Route path="/reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
              <Route path="/import" element={<Guard perm="excel.import"><ExcelImport /></Guard>} />
              <Route path="/audit" element={<Guard perm="audit.view"><AuditLog /></Guard>} />
              <Route path="/users" element={<Guard perm="users.manage"><Users /></Guard>} />
              <Route path="/backup" element={<Guard perm="backup.manage"><Backup /></Guard>} />
              <Route path="/settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}

function Guard({ perm, children }) {
  const { can } = useApp();
  if (!can(perm)) {
    return <div className="alert bad">ليست لديك صلاحية الوصول إلى هذه الصفحة. راجع مدير النظام.</div>;
  }
  return children;
}
