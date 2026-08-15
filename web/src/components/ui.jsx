import { useEffect, useState, createContext, useContext, useCallback } from 'react';

/* ---------------- أيقونات SVG محلية (بلا إنترنت) ---------------- */
const P = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17 14.4a5 5 0 0 1 3.5 4.6" /></>,
  cash: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6 12h.01M18 12h.01" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  receipt: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  badge: <><path d="M12 2.5l2.4 1.6 2.9-.2 1 2.7 2.4 1.6-1 2.8 1 2.8-2.4 1.6-1 2.7-2.9-.2L12 19.7 9.6 18l-2.9.2-1-2.7L3.3 14l1-2.8-1-2.8 2.4-1.6 1-2.7 2.9.2z" /></>,
  shirt: <><path d="M8 3.5L4 6l1.5 4L8 9v11.5h8V9l2.5 1L20 6l-4-2.5-2 2h-4z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  upload: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3 4v4.5h4.5" /><path d="M12 7.5V12l3 2" /></>,
  shield: <><path d="M12 2.8l7.5 3v6c0 4.4-3.1 8.2-7.5 9.4-4.4-1.2-7.5-5-7.5-9.4v-6z" /><path d="M9 12l2 2 4-4" /></>,
  save: <><path d="M5 3.5h11L20.5 8v12.5H5z" /><path d="M8 3.5v6h8" /><rect x="8" y="13" width="8" height="7.5" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  print: <><path d="M6.5 9V3.5h11V9" /><rect x="3.5" y="9" width="17" height="7.5" rx="2" /><path d="M6.5 14h11v6.5h-11z" /></>,
  download: <><path d="M12 4v12M8 12l4 4 4-4" /><path d="M4 20h16" /></>,
  check: <><path d="M4 12.5l5 5L20 6.5" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" /></>,
  eye: <><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  archive: <><rect x="3" y="4" width="18" height="4.5" rx="1.5" /><path d="M5 8.5V20h14V8.5" /><path d="M10 13h4" /></>,
  logout: <><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  warn: <><path d="M12 3.5L21.5 20h-19z" /><path d="M12 10v4M12 17.2h.01" /></>,
  back: <><path d="M15 5l-7 7 7 7" /></>
};

export function Icon({ name, size = 18, style, className }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flex: 'none', ...style }} className={className} aria-hidden="true">{d}</svg>
  );
}

/* ---------------- إشعارات ---------------- */
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  const value = {
    show: push,
    ok: (m) => push(m, 'ok'),
    error: (m) => push(m, 'bad'),
    info: (m) => push(m, '')
  };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- نافذة ---------------- */
export function Modal({ title, children, onClose, wide = false, actions }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="card-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="إغلاق"><Icon name="close" size={16} /></button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** تأكيد العمليات الحساسة */
export function Confirm({ title, message, confirmText = 'تأكيد', danger = false, requireText, onConfirm, onClose, busy }) {
  const [typed, setTyped] = useState('');
  const ready = !requireText || typed.trim() === requireText;
  return (
    <Modal title={title} onClose={onClose} actions={
      <>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ready || busy} onClick={onConfirm}>
          {busy ? 'جارٍ التنفيذ…' : confirmText}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </>
    }>
      <div className={`alert ${danger ? 'bad' : 'warn'}`}>{message}</div>
      {requireText && (
        <div className="field">
          <label>للتأكيد اكتب: «{requireText}»</label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
      )}
    </Modal>
  );
}

/* ---------------- حالات ---------------- */
export const Spinner = () => <div className="spinner" aria-label="جارٍ التحميل" />;

export function Empty({ title = 'لا توجد بيانات', hint, action }) {
  return (
    <div className="empty">
      <div className="big">🗂️</div>
      <b>{title}</b>
      {hint && <p className="hint">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert bad">
      {error.message || 'حدث خطأ.'}
      {onRetry && <button className="btn btn-sm" style={{ marginInlineStart: 10 }} onClick={onRetry}>إعادة المحاولة</button>}
    </div>
  );
}

/* ---------------- ترقيم الصفحات ---------------- */
export function Pager({ page, pages, total, onPage }) {
  if (!pages || pages <= 1) return <div className="pager"><span className="info">إجمالي السجلات: {total ?? 0}</span></div>;
  return (
    <div className="pager">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</button>
      <span className="info">صفحة {page} من {pages} · {total} سجل</span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</button>
    </div>
  );
}

/* ---------------- بحث بتأخير ---------------- */
export function SearchBox({ value, onChange, placeholder = 'ابحث…', delay = 350 }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, delay);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="search grow">
      <span className="ico"><Icon name="search" size={16} /></span>
      <input className="input" value={local} placeholder={placeholder} onChange={(e) => setLocal(e.target.value)} />
    </div>
  );
}

/* ---------------- شارة حالة الدفع ---------------- */
const STATUS = {
  paid: ['ok', 'مسدد بالكامل'],
  partial: ['warn', 'مسدد جزئيًا'],
  unpaid: ['bad', 'غير مسدد'],
  not_required: ['grey', 'غير مطلوب'],
  late: ['bad', 'متأخر'],
  due: ['warn', 'مستحق'],
  not_due: ['grey', 'غير مستحق'],
  active: ['ok', 'سارية'],
  void: ['bad', 'ملغاة'],
  archived: ['grey', 'مؤرشف'],
  ready: ['ok', 'جاهز'],
  duplicate_in_file: ['warn', 'مكرر في الملف'],
  exists: ['warn', 'موجود مسبقًا'],
  missing: ['bad', 'بيانات ناقصة'],
  error: ['bad', 'خطأ'],
  imported: ['ok', 'تم الاستيراد']
};

export function StatusBadge({ status, label }) {
  const [kind, text] = STATUS[status] || ['grey', label || status || '—'];
  return <span className={`badge ${kind}`}><i className="dot" />{label || text}</span>;
}

export default { Icon, Modal, Confirm, Spinner, Empty, ErrorBox, Pager, SearchBox, StatusBadge, ToastProvider, useToast };
