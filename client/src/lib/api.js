import { useCallback, useEffect, useState } from 'react';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Fetch hook with refetch + loading/error state. `deps` re-triggers the request. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { ...state, refetch };
}

export const fmtMoney = (n, opts = {}) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts });
export const fmtMoney2 = (n) => fmtMoney(n, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const fmtPct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
export const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};
export const fmtDate = (s) => new Date(s + (s.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const PROVIDER_LABEL = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };
export const PROVIDER_COLOR = { aws: '#f59e0b', gcp: '#3b82f6', azure: '#0ea5e9' };
export const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#94a3b8'];

export const SEVERITY_TONE = { critical: 'red', warning: 'amber', info: 'blue' };
export const STATUS_TONE = { ok: 'green', 'at-risk': 'blue', warning: 'amber', exceeded: 'red', open: 'red', acknowledged: 'amber', resolved: 'green' };
