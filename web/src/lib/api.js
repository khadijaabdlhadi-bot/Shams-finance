const TOKEN_KEY = 'shams_finance_token';
let memoryToken = null;

export const token = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || memoryToken; } catch { return memoryToken; } },
  set(t) { memoryToken = t; try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ذاكرة فقط */ } },
  clear() { memoryToken = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
};

async function request(path, { method = 'GET', body, raw = false, blob = false } = {}) {
  const t = token.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(t ? { Authorization: `Bearer ${t}` } : {})
    },
    body: raw ? body : (body === undefined ? undefined : JSON.stringify(body))
  });

  if (res.status === 401) {
    token.clear();
    window.dispatchEvent(new CustomEvent('shams:logout'));
  }

  if (blob) {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(data.message || 'تعذّر تنزيل الملف.'), { status: res.status, data });
    }
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || 'حدث خطأ غير متوقع.'), { status: res.status, data });
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, formData) => request(p, { method: 'POST', body: formData, raw: true }),
  blob: (p) => request(p, { blob: true })
};

/** تنزيل ملف مع ترويسة الجلسة (الروابط المباشرة لا تحمل التوكن) */
export async function download(path, filename) {
  const b = await api.blob(path);
  const url = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** فتح صفحة طباعة (HTML) في نافذة جديدة مع التوكن */
export async function openPrint(path) {
  const b = await api.blob(path);
  const url = URL.createObjectURL(b);
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => { try { win.print(); } catch { /* ignore */ } });
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!win;
}

export default api;
