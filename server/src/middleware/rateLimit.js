import { clientIp } from '../lib/audit.js';

/**
 * تحديد معدل المحاولات — في الذاكرة، كافٍ لخادم مدرسة واحد.
 * الهدف: منع تخمين كلمات المرور.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 30, key = null } = {}) {
  return (req, res, next) => {
    // key قد يكون نصًا أو دالة تُرجع تمييزًا إضافيًا (اسم المستخدم مثلًا)
    const scope = typeof key === 'function' ? key(req) : (key || req.path);
    const id = `${scope}:${clientIp(req) || 'unknown'}`;
    const now = Date.now();
    const b = buckets.get(id);
    if (!b || now > b.reset) {
      buckets.set(id, { count: 1, reset: now + windowMs });
      return next();
    }
    b.count++;
    if (b.count > max) {
      const wait = Math.ceil((b.reset - now) / 1000);
      return res.status(429).json({
        error: 'too_many_requests',
        message: `عدد المحاولات كبير. يرجى الانتظار ${wait} ثانية ثم المحاولة مرة أخرى.`
      });
    }
    next();
  };
}

// تنظيف دوري حتى لا تكبر الخريطة
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 60_000).unref?.();

export default rateLimit;
