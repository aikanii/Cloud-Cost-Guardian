import { useState } from 'react';
import { api, useApi, qs, fmtMoney, SEVERITY_TONE, STATUS_TONE } from '../lib/api.js';
import { Card, Loading, ErrorState, Badge, Empty } from '../components/ui.jsx';
import { useToast } from '../lib/context.js';

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const alerts = useApi(`/alerts${qs({ status, type })}`);
  const anomalies = useApi('/anomalies');
  const toast = useToast();

  const update = async (a, st) => {
    try { await api(`/alerts/${a.id}`, { method: 'PATCH', body: { status: st } }); toast(`Alert ${st}`); alerts.refetch(); window.dispatchEvent(new Event('hashchange')); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Alerts</h1><p className="muted">Budget thresholds, forecasts and anomaly detections</p></div>
      </div>
      <div className="toolbar">
        <div className="segmented">{[['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved'], ['', 'All']].map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}</div>
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="budget">Budget</option><option value="forecast">Forecast</option><option value="anomaly">Anomaly</option></select>
      </div>

      <Card>
        {alerts.loading ? <Loading /> : alerts.error ? <ErrorState error={alerts.error} onRetry={alerts.refetch} /> : alerts.data.length === 0 ? <Empty>No alerts match this filter.</Empty> : (
          <div className="list">
            {alerts.data.map((a) => (
              <div key={a.id} className="list-item">
                <span className={`sev-dot sev-${a.severity}`} />
                <div className="body">
                  <div className="row"><span className="title">{a.title}</span><Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge><Badge>{a.type}</Badge>{a.status !== 'open' && <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>}</div>
                  <div className="meta">{a.message}</div>
                  <div className="meta">Created {new Date(a.created_at + 'Z').toLocaleString()} · updated {new Date(a.updated_at + 'Z').toLocaleString()}</div>
                </div>
                <div className="row nowrap">
                  {a.status === 'open' && <button className="btn btn-sm" onClick={() => update(a, 'acknowledged')}>Acknowledge</button>}
                  {a.status !== 'resolved' && <button className="btn btn-sm btn-primary" onClick={() => update(a, 'resolved')}>Resolve</button>}
                  {a.status === 'resolved' && <button className="btn btn-sm" onClick={() => update(a, 'open')}>Reopen</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Anomaly detector" subtitle="Daily (account, service) spend compared against a 21-day rolling baseline; flagged when z-score > 3 and increase > 40%">
        {anomalies.loading ? <Loading /> : anomalies.data.length === 0 ? <Empty>No anomalies detected in the last 14 days.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Account</th><th>Service</th><th className="right">Actual</th><th className="right">Expected</th><th className="right">Delta</th><th className="right">z-score</th><th>Severity</th></tr></thead>
              <tbody>
                {anomalies.data.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{a.date}</td><td>{a.account}</td><td>{a.service}</td>
                    <td className="right"><strong>{fmtMoney(a.cost)}</strong></td><td className="right muted">{fmtMoney(a.expected)}</td>
                    <td className="right" style={{ color: 'var(--red)' }}>+{fmtMoney(a.delta)} ({a.pctIncrease}%)</td>
                    <td className="right mono">{a.zScore}</td>
                    <td><Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
