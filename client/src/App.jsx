import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastCtx, FilterCtx, useToast, useGlobalFilters } from './lib/context.js';
import { api, useApi } from './lib/api.js';
import Dashboard from './pages/Dashboard.jsx';
import Explorer from './pages/Explorer.jsx';
import Budgets from './pages/Budgets.jsx';
import Alerts from './pages/Alerts.jsx';
import Recommendations from './pages/Recommendations.jsx';
import Resources from './pages/Resources.jsx';
import Accounts from './pages/Accounts.jsx';
import Governance from './pages/Governance.jsx';
import Forecast from './pages/Forecast.jsx';
import Settings from './pages/Settings.jsx';

const ROUTES = [
  { path: '/', label: 'Dashboard', icon: '▦', component: Dashboard },
  { path: '/explorer', label: 'Cost Explorer', icon: '◔', component: Explorer },
  { path: '/forecast', label: 'Forecast', icon: '↗', component: Forecast },
  { path: '/budgets', label: 'Budgets', icon: '◎', component: Budgets },
  { path: '/alerts', label: 'Alerts', icon: '⚠', component: Alerts, badge: 'alerts' },
  { path: '/recommendations', label: 'Savings', icon: '✦', component: Recommendations },
  { path: '/resources', label: 'Resources', icon: '▤', component: Resources },
  { path: '/governance', label: 'Governance', icon: '✓', component: Governance },
  { path: '/accounts', label: 'Accounts', icon: '☁', component: Accounts },
  { path: '/settings', label: 'Settings', icon: '⚙', component: Settings },
];

function useHashRoute() {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [path, setPath] = useState(get);
  useEffect(() => {
    const on = () => setPath(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export default function App() {
  const path = useHashRoute();
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('ccg-theme') || 'light');
  const [filters, setFilters] = useState({ provider: '', accountId: '' });
  const showToast = useCallback((message, type = 'ok') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ccg-theme', theme);
  }, [theme]);

  const openAlerts = useApi('/alerts?status=open', [path]);
  const filterOpts = useApi('/costs/filters');

  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  const Page = route.component;
  const filterValue = useMemo(() => ({ filters, setFilters, options: filterOpts.data }), [filters, filterOpts.data]);

  return (
    <ToastCtx.Provider value={showToast}>
      <FilterCtx.Provider value={filterValue}>
        <div className="layout">
          <aside className="sidebar">
            <a className="brand" href="#/">
              <svg viewBox="0 0 32 32"><path d="M16 2 4 7v8c0 7 5 13 12 15 7-2 12-8 12-15V7z" fill="#2563eb" /><path d="M11 17l3 3 7-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Cost Guardian
            </a>
            {ROUTES.map((r) => (
              <a key={r.path} href={`#${r.path}`} className={`nav-link ${route.path === r.path ? 'active' : ''}`}>
                <span className="icon">{r.icon}</span>{r.label}
                {r.badge === 'alerts' && openAlerts.data?.length > 0 && <span className="count">{openAlerts.data.length}</span>}
              </a>
            ))}
            <div className="sidebar-foot">
              <button className="btn btn-sm btn-ghost" style={{ color: '#aab4c5', justifyContent: 'flex-start' }} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                {theme === 'light' ? '☾ Dark mode' : '☀ Light mode'}
              </button>
              <span>Multi-cloud FinOps · v1.0</span>
            </div>
          </aside>
          <main className="main">
            <GlobalFilterBar />
            <Page key={route.path} />
          </main>
        </div>
        {toast && <div className={`toast ${toast.type === 'error' ? 'error' : ''}`}>{toast.message}</div>}
      </FilterCtx.Provider>
    </ToastCtx.Provider>
  );
}

function GlobalFilterBar() {
  const { filters, setFilters, options } = useGlobalFilters();
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const active = Object.entries(filters).filter(([, v]) => v);
  const accounts = (options?.accounts || []).filter((a) => !filters.provider || a.provider === filters.provider);
  const evaluate = async () => {
    setRefreshing(true);
    try { const r = await api('/alerts/evaluate', { method: 'POST' }); toast(`Alerts evaluated · ${r.total} open`); window.dispatchEvent(new Event('hashchange')); }
    catch (e) { toast(e.message, 'error'); }
    finally { setRefreshing(false); }
  };
  return (
    <div className="toolbar" style={{ marginBottom: 20 }}>
      <select value={filters.provider} onChange={(e) => setFilters({ provider: e.target.value, accountId: '' })} aria-label="Provider">
        <option value="">All providers</option>
        {(options?.providers || []).map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
      </select>
      <select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })} aria-label="Account">
        <option value="">All accounts</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {active.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setFilters({ provider: '', accountId: '' })}>Clear filters</button>}
      <span className="grow" />
      <button className="btn btn-sm" onClick={evaluate} disabled={refreshing}>{refreshing ? 'Evaluating…' : '↻ Re-evaluate alerts'}</button>
    </div>
  );
}
