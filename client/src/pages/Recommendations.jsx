import { useMemo, useState } from 'react';
import { api, useApi, fmtMoney } from '../lib/api.js';
import { Card, Kpi, Loading, ErrorState, Badge, Empty, ProviderBadge, PageHeader } from '../components/ui.jsx';
import { useGlobalFilters, useToast } from '../lib/context.js';

const TYPE_META = {
  idle: { icon: '💤', label: 'Idle resource', bg: 'rgba(248,113,113,.15)' },
  unused: { icon: '🗑', label: 'Unused', bg: 'rgba(251,191,36,.15)' },
  rightsize: { icon: '📐', label: 'Rightsizing', bg: 'rgba(96,165,250,.15)' },
  commitment: { icon: '📜', label: 'Commitment', bg: 'rgba(168,85,247,.15)' },
  storage: { icon: '🗄', label: 'Storage tiering', bg: 'rgba(52,211,153,.15)' },
  governance: { icon: '🏷', label: 'Governance', bg: 'rgba(148,163,184,.15)' },
};

export default function Recommendations() {
  const recs = useApi('/recommendations?all=true');
  const { filters } = useGlobalFilters();
  const toast = useToast();
  const [type, setType] = useState('');
  const [view, setView] = useState('open');

  const rows = useMemo(() => (recs.data || []).filter((r) =>
    (!type || r.type === type)
    && (view === 'all' || r.status === view)
    && (!filters.provider || r.provider === filters.provider)
    && (!filters.accountId || String(r.accountId) === String(filters.accountId))), [recs.data, type, view, filters]);
  const open = (recs.data || []).filter((r) => r.status === 'open');
  const totalSavings = open.reduce((s, r) => s + r.monthlySavings, 0);
  const applied = (recs.data || []).filter((r) => r.status === 'applied').reduce((s, r) => s + r.monthlySavings, 0);
  const byType = Object.keys(TYPE_META).map((t) => ({ t, n: open.filter((r) => r.type === t).length, s: open.filter((r) => r.type === t).reduce((a, r) => a + r.monthlySavings, 0) })).filter((x) => x.n);

  const act = async (r, action) => {
    try { await api(`/recommendations/${encodeURIComponent(r.fingerprint)}/${action}`, { method: 'POST' }); toast(action === 'open' ? 'Recommendation reopened' : `Marked as ${action}`); recs.refetch(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="stack">
      <PageHeader eyebrow="Optimization" title="Savings recommendations" subtitle={<>Actionable optimizations across compute, storage, commitments and governance</>} />
      <div className="grid grid-4">
        <Kpi label="Open opportunities" raw={open.length} format={(v) => Math.round(v)} />
        <Kpi label="Potential monthly savings" raw={totalSavings} format={fmtMoney} tone="accent" />
        <Kpi label="Annualized" raw={totalSavings * 12} format={fmtMoney} />
        <Kpi label="Realized (applied)" value={`${fmtMoney(applied)}/mo`} />
      </div>

      <div className="toolbar">
        <div className="segmented">{[['open', 'Open'], ['applied', 'Applied'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([v, l]) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{l}</button>)}</div>
        <button className={`btn btn-sm ${type === '' ? 'btn-primary' : ''}`} onClick={() => setType('')}>All types</button>
        {byType.map((x) => <button key={x.t} className={`btn btn-sm ${type === x.t ? 'btn-primary' : ''}`} onClick={() => setType(type === x.t ? '' : x.t)}>{TYPE_META[x.t].icon} {TYPE_META[x.t].label} ({x.n}) · {fmtMoney(x.s)}</button>)}
      </div>

      <Card>
        {recs.loading ? <Loading /> : recs.error ? <ErrorState error={recs.error} onRetry={recs.refetch} /> : rows.length === 0 ? <Empty>Nothing here.</Empty> : (
          <div className="list">
            {rows.map((r) => {
              const m = TYPE_META[r.type];
              return (
                <div key={r.fingerprint} className="list-item">
                  <div className="rec-type" style={{ background: m.bg }}>{m.icon}</div>
                  <div className="body">
                    <div className="row"><span className="title">{r.title}</span><Badge tone={r.effort === 'low' ? 'green' : 'amber'}>{r.effort} effort</Badge><Badge tone={r.risk === 'low' ? 'green' : 'amber'}>{r.risk} risk</Badge>{r.status !== 'open' && <Badge tone={r.status === 'applied' ? 'green' : 'gray'}>{r.status}</Badge>}</div>
                    <div className="meta">{r.description}</div>
                    <div className="meta row" style={{ marginTop: 4 }}><ProviderBadge provider={r.provider} /> {r.account} · {r.service} · {r.region}{r.resourceId && <> · <span className="mono">{r.resourceId}</span></>}</div>
                  </div>
                  <div className="right" style={{ minWidth: 130 }}>
                    <div className="savings" style={{ fontSize: 16 }}>{r.monthlySavings > 0 ? `${fmtMoney(r.monthlySavings)}/mo` : '—'}</div>
                    <div className="muted small">current {fmtMoney(r.monthlyCost)}/mo</div>
                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                      {r.status === 'open' ? <><button className="btn btn-sm" onClick={() => act(r, 'dismissed')}>Dismiss</button><button className="btn btn-sm btn-primary" onClick={() => act(r, 'applied')}>Applied</button></>
                        : <button className="btn btn-sm" onClick={() => act(r, 'open')}>Reopen</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
