import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, Legend } from 'recharts';
import { useApi, qs, fmtMoney, fmtCompact, fmtDate, PALETTE, PROVIDER_COLOR, PROVIDER_LABEL, SEVERITY_TONE, STATUS_TONE } from '../lib/api.js';
import { Card, Kpi, Loading, ErrorState, Badge, Tooltip, Progress, Empty } from '../components/ui.jsx';
import { useGlobalFilters } from '../lib/context.js';

export default function Dashboard() {
  const { filters } = useGlobalFilters();
  const f = qs({ ...filters, days: 30 });
  const summary = useApi(`/costs/summary${qs(filters)}`);
  const daily = useApi(`/costs/daily-breakdown${f}&groupBy=service&limit=5`);
  const byProvider = useApi(`/costs/breakdown${f}&groupBy=provider`);
  const byService = useApi(`/costs/breakdown${f}&groupBy=service`);
  const budgets = useApi('/budgets');
  const alerts = useApi('/alerts?status=open');
  const recs = useApi('/recommendations');

  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.refetch} />;
  const s = summary.data;

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Overview</h1><p className="muted">Multi-cloud spend at a glance · as of {s ? fmtDate(s.asOf) : '…'}</p></div>
        <a className="btn" href={`/api/costs/export${f}`}>⬇ Export CSV (30d)</a>
      </div>

      {!s ? <Loading /> : (
        <div className="grid grid-4">
          <Kpi label="Month to date" value={fmtMoney(s.monthToDate)} delta={s.monthToDateChangePct} deltaLabel="vs same period last month" />
          <Kpi label="Forecast month end" value={fmtMoney(s.forecastMonthEnd)} delta={s.forecastChangePct} deltaLabel={`vs last month (${fmtMoney(s.prevMonthTotal)})`} />
          <Kpi label="Last 7 days" value={fmtMoney(s.last7Days)} delta={s.last7ChangePct} deltaLabel="vs prior 7 days" />
          <Kpi label="Potential savings" value={`${fmtMoney(s.potentialSavings)}/mo`} hint={`${s.openAlerts} open alert${s.openAlerts === 1 ? '' : 's'}`} tone="accent" />
        </div>
      )}

      <div className="grid grid-3">
        <Card className="span-2" title="Daily spend by service" subtitle="Last 30 days, top 5 services">
          {daily.loading ? <Loading /> : daily.error ? <ErrorState error={daily.error} /> : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={daily.data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
                <RTooltip content={<Tooltip />} labelFormatter={fmtDate} />
                {daily.data.keys.map((k, i) => (
                  <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.75} />
                ))}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Spend by provider" subtitle="Last 30 days">
          {byProvider.loading ? <Loading /> : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byProvider.data} dataKey="cost" nameKey="key" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {byProvider.data.map((d) => <Cell key={d.key} fill={PROVIDER_COLOR[d.key] || '#94a3b8'} />)}
                  </Pie>
                  <RTooltip content={<Tooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="list">
                {byProvider.data.map((d) => {
                  const total = byProvider.data.reduce((t, x) => t + x.cost, 0);
                  return (
                    <div key={d.key} className="row between" style={{ padding: '6px 0' }}>
                      <span className="row"><span className="dot" style={{ background: PROVIDER_COLOR[d.key] }} />{PROVIDER_LABEL[d.key] || d.key}</span>
                      <span><strong>{fmtMoney(d.cost)}</strong> <span className="muted small">{total ? ((d.cost / total) * 100).toFixed(0) : 0}%</span></span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Top services" subtitle="Last 30 days" actions={<a className="btn btn-sm" href="#/explorer">Explore →</a>}>
          {byService.loading ? <Loading /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byService.data.slice(0, 8)} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="category" dataKey="key" width={100} tick={{ fontSize: 11, fill: 'var(--text)' }} />
                <RTooltip content={<Tooltip />} cursor={{ fill: 'var(--bg)' }} />
                <Bar dataKey="cost" name="Cost" fill="var(--primary)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Budgets" actions={<a className="btn btn-sm" href="#/budgets">Manage →</a>}>
          {budgets.loading ? <Loading /> : budgets.data.length === 0 ? <Empty>No budgets yet.</Empty> : (
            <div className="list">
              {budgets.data.slice(0, 5).map((b) => (
                <div key={b.id} style={{ padding: '8px 0' }}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span><strong>{b.name}</strong> <span className="muted small">· {b.scopeLabel}</span></span>
                    <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                  </div>
                  <Progress pct={b.pctUsed} tone={STATUS_TONE[b.status]} marker={b.threshold_pct} />
                  <div className="row between small muted" style={{ marginTop: 4 }}>
                    <span>{fmtMoney(b.spent)} of {fmtMoney(b.amount)} ({b.pctUsed}%)</span>
                    <span>proj. {fmtMoney(b.projected)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Open alerts" actions={<a className="btn btn-sm" href="#/alerts">View all →</a>}>
          {alerts.loading ? <Loading /> : alerts.data.length === 0 ? <Empty>🎉 No open alerts.</Empty> : (
            <div className="list">
              {alerts.data.slice(0, 5).map((a) => (
                <div key={a.id} className="list-item">
                  <span className={`sev-dot sev-${a.severity}`} />
                  <div className="body">
                    <div className="title" style={{ fontSize: 13 }}>{a.title}</div>
                    <div className="meta">{a.message}</div>
                  </div>
                  <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Top savings opportunities" subtitle="Highest-impact recommendations" actions={<a className="btn btn-sm" href="#/recommendations">All recommendations →</a>}>
        {recs.loading ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Recommendation</th><th>Account</th><th>Type</th><th>Effort</th><th className="right">Monthly savings</th></tr></thead>
              <tbody>
                {recs.data.filter((r) => r.monthlySavings > 0).slice(0, 5).map((r) => (
                  <tr key={r.fingerprint}>
                    <td><strong>{r.title}</strong><div className="muted small">{r.resourceName}</div></td>
                    <td>{r.account}</td>
                    <td><Badge tone="purple">{r.type}</Badge></td>
                    <td><Badge tone={r.effort === 'low' ? 'green' : 'amber'}>{r.effort}</Badge></td>
                    <td className="right savings">{fmtMoney(r.monthlySavings)}</td>
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
