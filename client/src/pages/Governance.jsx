import { useApi, fmtMoney } from '../lib/api.js';
import { Card, Kpi, Loading, ErrorState, Badge, Empty, ProviderBadge, Progress } from '../components/ui.jsx';

export default function Governance() {
  const g = useApi('/governance/tags');
  if (g.loading) return <Loading />;
  if (g.error) return <ErrorState error={g.error} onRetry={g.refetch} />;
  const d = g.data;
  const tone = d.compliancePct >= 90 ? 'green' : d.compliancePct >= 70 ? 'amber' : 'red';
  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Tag governance</h1><p className="muted">Required tags: {d.requiredTags.map((t) => <span key={t} className="tag">{t}</span>)} <a href="#/settings" className="small">change</a></p></div>
      </div>
      <div className="grid grid-4">
        <Kpi label="Resource compliance" value={`${d.compliancePct}%`} hint={`${d.compliantResources} of ${d.totalResources} resources fully tagged`} />
        <Kpi label="Cost coverage" value={`${d.costCoveragePct}%`} hint="share of 30d spend that is fully attributable" />
        <Kpi label="Violations" value={d.violations.length} />
        <Kpi label="Unattributed spend" value={fmtMoney(d.violations.reduce((s, v) => s + v.monthlyCost, 0))} hint="per month" />
      </div>
      <Card title="Compliance"><Progress pct={d.compliancePct} tone={tone} /><p className="muted small" style={{ marginTop: 6 }}>Target ≥ 90%</p></Card>
      <Card title="Violations" subtitle="Resources missing one or more required tags, most expensive first">
        {d.violations.length === 0 ? <Empty>🎉 All resources are compliant.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Resource</th><th>Account</th><th>Service</th><th>Missing tags</th><th className="right">Monthly cost</th></tr></thead>
              <tbody>
                {d.violations.map((v) => (
                  <tr key={v.resourceId}>
                    <td><strong>{v.name}</strong><div className="mono muted">{v.resourceId}</div></td>
                    <td><div className="row"><ProviderBadge provider={v.provider} /><span className="small">{v.account}</span></div></td>
                    <td>{v.service}</td>
                    <td>{v.missing.map((m) => <Badge key={m} tone="red">{m}</Badge>)}</td>
                    <td className="right"><strong>{fmtMoney(v.monthlyCost)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Tip: fix tags from the <a href="#/resources">Resources</a> page by clicking a row.</p>
      </Card>
    </div>
  );
}
