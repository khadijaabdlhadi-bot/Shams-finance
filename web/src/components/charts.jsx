import { useState } from 'react';
import { money, num } from '../lib/format.js';

/**
 * رسوم بيانية مرسومة يدويًا بـ SVG — بلا مكتبات وبلا إنترنت.
 * الألوان مُتحقَّق منها لعمى الألوان والتباين، وكل قيمة مكتوبة بجانب شكلها
 * حتى لا تعتمد القراءة على اللون وحده.
 */
export const C = { blue: '#1E6FBF', gold: '#C07C0A', green: '#0E8A63', red: '#C42B30', grey: '#94A3B8' };
const SURFACE = '#FFFFFF';

/* ---------- شريط أفقي مقسوم: المحصّل مقابل المتبقي ---------- */
export function SplitBar({ paid, balance, height = 26 }) {
  const p = Number(paid) || 0;
  const b = Math.max(0, Number(balance) || 0);
  const total = p + b;
  const pct = total > 0 ? (p / total) * 100 : 0;

  return (
    <div>
      <div style={{
        display: 'flex', height, borderRadius: 999, overflow: 'hidden',
        background: '#EEF2F7', gap: total > 0 && pct > 0 && pct < 100 ? 2 : 0
      }}>
        {pct > 0 && <div style={{ width: `${pct}%`, background: C.green, borderRadius: 999 }} title={`المحصّل ${money(paid)}`} />}
        {pct < 100 && <div style={{ width: `${100 - pct}%`, background: C.gold, borderRadius: 999 }} title={`المتبقي ${money(balance)}`} />}
      </div>
      <div className="chart-legend">
        <span><i style={{ background: C.green }} />المحصّل <b className="num">{money(paid)}</b></span>
        <span><i style={{ background: C.gold }} />المتبقي <b className="num">{money(balance)}</b></span>
        <span className="chart-note">نسبة التحصيل {Math.round(pct)}%</span>
      </div>
    </div>
  );
}

/* ---------- أعمدة: التحصيلات الشهرية ---------- */
export function Bars({ data, height = 190, color = C.blue, valueFormat = money }) {
  const [hover, setHover] = useState(null);
  const rows = (data || []).filter(Boolean);
  if (!rows.length) return <p className="hint">لا توجد بيانات لعرضها.</p>;

  const max = Math.max(...rows.map((d) => Number(d.value) || 0), 1);
  const w = 100 / rows.length;
  // مع شهر أو شهرين فقط لا نريد عمودًا يملأ العرض كله
  const barW = Math.min(w * 0.56, 9);

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height, overflow: 'visible' }}>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1="0" x2="100" y1={height - g * (height - 26)} y2={height - g * (height - 26)}
            stroke="#EEF2F7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {rows.map((d, i) => {
          const val = Number(d.value) || 0;
          const h = Math.max(2, (val / max) * (height - 30));
          return (
            <rect key={i} x={i * w + (w - barW) / 2} y={height - 20 - h} width={barW} height={h}
              rx="1.5" fill={color} opacity={hover === null || hover === i ? 1 : 0.55}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
      </svg>
      <div style={{ display: 'flex', marginTop: 4 }}>
        {rows.map((d, i) => (
          <div key={i} style={{ width: `${w}%`, textAlign: 'center', fontSize: '.68rem', color: '#51637A', fontWeight: 600 }}>
            {d.label}
          </div>
        ))}
      </div>
      {hover !== null && (
        <div style={{
          position: 'absolute', top: 0, insetInlineStart: `${hover * w + w / 2}%`, transform: 'translateX(50%)',
          background: '#101C28', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: '.75rem',
          fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>
          {rows[hover].label}: {valueFormat(rows[hover].value)}
        </div>
      )}
    </div>
  );
}

/* ---------- أشرطة مسمّاة: طرق الدفع ---------- */
export function LabeledBars({ data, colors = [C.blue, C.gold, C.green, C.grey], format = money }) {
  const rows = (data || []).map((d) => ({ ...d, value: Number(d.value) || 0 }));
  const max = Math.max(...rows.map((d) => d.value), 1);
  if (!rows.length) return <p className="hint">لا توجد بيانات لعرضها.</p>;
  return (
    <div className="rows">
      {rows.map((d, i) => (
        <div key={d.label} style={{ padding: '7px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', fontWeight: 700 }}>
            <span>{d.label}{d.count !== undefined && <span className="hint" style={{ marginInlineStart: 6 }}>({num(d.count)} عملية)</span>}</span>
            <span className="num">{format(d.value)}</span>
          </div>
          <div style={{ height: 9, background: '#EEF2F7', borderRadius: 999, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: colors[i % colors.length], borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- دائرة: حالات الدفع ---------- */
export function Donut({ data, size = 168, colors = [C.green, C.gold, C.red] }) {
  const [hover, setHover] = useState(null);
  const rows = (data || []).map((d) => ({ ...d, value: Number(d.value) || 0 }));
  const total = rows.reduce((s, d) => s + d.value, 0);
  if (!total) return <p className="hint">لا توجد بيانات لعرضها.</p>;

  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
          {rows.map((d, i) => {
            const len = (d.value / total) * c;
            const gap = rows.length > 1 ? 2 : 0;
            const el = (
              <circle key={d.label} r={r} fill="none" stroke={colors[i % colors.length]}
                strokeWidth={hover === i ? 22 : 18}
                strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
                strokeDashoffset={-offset}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
            offset += len;
            return el;
          })}
          <circle r={r - 14} fill={SURFACE} />
        </g>
        <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: '#101C28' }}>
          {num(hover === null ? total : rows[hover].value)}
        </text>
        <text x="50%" y="60%" textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#51637A' }}>
          {hover === null ? 'طالب' : rows[hover].label}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 150 }}>
        {rows.map((d, i) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: '.82rem' }}>
            <i style={{ width: 11, height: 11, borderRadius: 3, background: colors[i % colors.length], display: 'inline-block' }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <b className="num">{num(d.value)}</b>
            <span className="hint">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default { SplitBar, Bars, LabeledBars, Donut, C };
