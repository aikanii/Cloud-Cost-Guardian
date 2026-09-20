import { useState } from 'react';
import { api, useApi } from '../lib/api.js';
import { Card, Loading, ErrorState, Field } from '../components/ui.jsx';
import { useToast } from '../lib/context.js';

export default function Settings() {
  const settings = useApi('/settings');
  const health = useApi('/health');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const reseed = async () => {
    if (!confirm('Regenerate demo data? This replaces all accounts, budgets, alerts and cost entries.')) return;
    setBusy(true);
    try { await api('/admin/reseed', { method: 'POST' }); toast('Demo data regenerated'); health.refetch(); window.dispatchEvent(new Event('hashchange')); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  if (settings.loading) return <Loading />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={settings.refetch} />;
  return <SettingsView key={settings.data.requiredTags.join(',')} settings={settings} health={health} toast={toast} busy={busy} reseed={reseed} />;
}

function SettingsView({ settings, health, toast, busy, reseed }) {
  const [tags, setTags] = useState(settings.data.requiredTags.join(', '));
  const save = async (e) => {
    e.preventDefault();
    try { await api('/settings', { method: 'PUT', body: { requiredTags: tags.split(',').map((s) => s.trim()).filter(Boolean) } }); toast('Settings saved'); settings.refetch(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="stack">
      <div className="page-header"><div><h1>Settings</h1><p className="muted">Governance policy and data management</p></div></div>
      <div className="grid grid-2">
        <Card title="Tag policy">
          <form onSubmit={save} className="stack" style={{ gap: 12 }}>
            <Field label="Required tags (comma-separated)" hint="Resources missing any of these are flagged on the Governance page."><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
            <div><button className="btn btn-primary" type="submit">Save</button></div>
          </form>
        </Card>
        <Card title="Data">
          <p className="muted" style={{ marginBottom: 12 }}>{health.data ? `${health.data.entries.toLocaleString()} cost entries stored.` : '…'} Alerts are re-evaluated automatically every 15 minutes.</p>
          <div className="row">
            <button className="btn" onClick={reseed} disabled={busy}>{busy ? 'Working…' : '⟳ Regenerate demo data'}</button>
            <a className="btn" href="/api/costs/export?days=365">⬇ Export all costs (CSV)</a>
          </div>
        </Card>
      </div>
      <Card title="API reference">
        <div className="table-wrap"><table>
          <thead><tr><th>Endpoint</th><th>Description</th></tr></thead>
          <tbody>
            {[
              ['GET /api/costs/summary', 'KPIs: MTD, forecast, 7/30-day totals with deltas'],
              ['GET /api/costs/daily?days=30', 'Daily totals (filters: provider, accountId, service, region, tag)'],
              ['GET /api/costs/breakdown?groupBy=service', 'Group totals by service/account/provider/region/team/env/cost-center'],
              ['GET /api/costs/daily-breakdown?groupBy=service&limit=6', 'Daily stacked series, top N + Other'],
              ['GET /api/costs/forecast?horizon=30', 'Trend forecast with confidence band'],
              ['GET /api/costs/export?format=csv', 'Raw cost entries export'],
              ['POST /api/costs/ingest', 'Bulk-insert cost entries'],
              ['GET /api/anomalies', 'Rolling z-score anomaly detection'],
              ['GET/POST/PUT/DELETE /api/budgets', 'Budget management with live status'],
              ['GET/PATCH /api/alerts · POST /api/alerts/evaluate', 'Alert lifecycle and on-demand evaluation'],
              ['GET /api/recommendations · POST /api/recommendations/:fp/:action', 'Savings opportunities; dismiss/apply'],
              ['GET /api/resources · PATCH /api/resources/:id', 'Inventory with 30-day cost; update tags/status'],
              ['GET /api/governance/tags', 'Tag compliance report'],
            ].map(([e, d]) => <tr key={e}><td className="mono nowrap">{e}</td><td className="muted">{d}</td></tr>)}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
