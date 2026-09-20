import { useEffect, useRef, useState } from 'react';
import { PROVIDER_LABEL, PROVIDER_COLOR } from '../lib/api.js';

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Animates a numeric value from 0 → target; returns the current frame value. */
export function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    const end = Number(target) || 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setVal(end); from.current = end; return; }
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(begin + (end - begin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/** Renders `format(animatedNumber)` — pass a raw number and a formatter. */
export function AnimatedNumber({ value, format = (v) => v }) {
  const v = useCountUp(value);
  return <>{format(v)}</>;
}

export function Kpi({ label, value, delta, deltaLabel, hint, tone, invert = false, raw, format }) {
  let cls = 'neutral';
  if (delta != null) {
    const good = invert ? delta > 0 : delta < 0;
    cls = delta === 0 ? 'neutral' : good ? 'good' : 'bad';
  }
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{raw != null ? <AnimatedNumber value={raw} format={format} /> : value}</div>
      {(delta != null || hint) && (
        <div className="kpi-foot">
          {delta != null && <span className={`delta ${cls}`}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}%</span>}
          <span className="muted small">{deltaLabel || hint}</span>
        </div>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProviderBadge({ provider }) {
  return (
    <span className="badge" style={{ background: PROVIDER_COLOR[provider] + '22', color: PROVIDER_COLOR[provider], borderColor: PROVIDER_COLOR[provider] + '55' }}>
      {PROVIDER_LABEL[provider] || provider}
    </span>
  );
}


export function Loading({ label = 'Loading…', chart = false, rows = 4 }) {
  if (chart) return <div className="skeleton chart" aria-label={label}><span /></div>;
  return <div className="skeleton" aria-label={label}>{Array.from({ length: rows }).map((_, i) => <span key={i} />)}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="state"><span className="spinner" /> {label}</div>;
}

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state error">
      <strong>Something went wrong.</strong> {error?.message || String(error)}
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="state muted">{children}</div>;
}

export function Progress({ pct, tone = 'blue', marker }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="progress">
      <div className={`progress-bar tone-${tone}`} style={{ width: `${p}%` }} />
      {marker != null && <div className="progress-marker" style={{ left: `${Math.min(100, marker)}%` }} title="Threshold" />}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export function Tooltip({ active, payload, label, money = true }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey || p.name} className="chart-tip-row">
          <span className="dot" style={{ background: p.color || p.fill }} />
          <span>{p.name}</span>
          <strong>{money ? `$${Number(p.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : p.value}</strong>
        </div>
      ))}
      {payload.length > 1 && money && (
        <div className="chart-tip-row total"><span />
          <span>Total</span><strong>${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong>
        </div>
      )}
    </div>
  );
}
