import { useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, Legend } from 'recharts';
import { useApi, qs, fmtMoney, fmtMoney2, fmtCompact, fmtDate, PALETTE } from '../lib/api.js';
import { Card, Loading, ErrorState, Tooltip } from '../components/ui.jsx';
import { useGlobalFilters } from '../lib/context.js';

const GROUPS = [['service', 'Service'], ['account', 'Account'], ['provider', 'Provider'], ['region', 'Region'], ['team', 'Team tag'], ['env', 'Env tag'], ['cost-center', 'Cost center']];
const RANGES = [[7, '7d'], [30, '30d'], [60, '60d'], [90, '90d']];

export default function Explorer() {
  const { filters, options } = useGlobalFilters();
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState('service');
  const [chart, setChart] = useState('bar');
  const [service, setService] = useState('');
  const [region, setRegion] = useState('');
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState(6);
  const [sort, setSort] = useState({ key: 'cost', dir: 'desc' });

  const params = { ...filters, days, service, region, tag };
  const daily = useApi(`/costs/daily-breakdown${qs({ ...params, groupBy, limit })}`);
  const breakdown = useApi(`/costs/breakdown${qs({ ...params, groupBy })}`);

  const total = useMemo(() => (breakdown.data || []).reduce((s, r) => s + r.cost, 0), [breakdown.data]);
  const rows = useMemo(() => {
    const r = [...(breakdown.data || [])];
    r.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * (sort.key === 'key' ? a.key.localeCompare(b.key) : a.cost - b.cost));
    return r;
  }, [breakdown.data, sort]);
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const ChartCmp = chart === 'line' ? LineChart : BarChart;

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Cost Explorer</h1><p className="muted">Slice and dice spend by any dimension</p></div>
        <a className="btn" href={`/api/costs/export${qs(params)}`}>⬇ Export CSV</a>
      </div>

      <div className="toolbar">
        <div className="segmented">{RANGES.map(([d, l]) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{l}</button>)}</div>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by">
          {GROUPS.map(([k, l]) => <option key={k} value={k}>Group: {l}</option>)}
        </select>
        <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service"><option value="">All services</option>{(options?.services || []).map((s) => <option key={s}>{s}</option>)}</select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region"><option value="">All regions</option>{(options?.regions || []).map((s) => <option key={s}>{s}</option>)}</select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">Any tag</option>
          {(options?.tags?.team || []).map((t) => <option key={t} value={`team=${t}`}>team={t}</option>)}
          {(options?.tags?.env || []).map((t) => <option key={t} value={`env=${t}`}>env={t}</option>)}
        </select>
        <span className="grow" />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Top N">{[4, 6, 8, 10].map((n) => <option key={n} value={n}>Top {n}</option>)}</select>
        <div className="segmented"><button className={chart === 'bar' ? 'active' : ''} onClick={() => setChart('bar')}>Stacked</button><button className={chart === 'line' ? 'active' : ''} onClick={() => setChart('line')}>Lines</button></div>
      </div>

      <Card title={`Daily cost by ${GROUPS.find((g) => g[0] === groupBy)[1].toLowerCase()}`} subtitle={`${fmtMoney(total)} total · ${fmtMoney(total / days)} per day average`}>
        {daily.loading ? <Loading /> : daily.error ? <ErrorState error={daily.error} onRetry={daily.refetch} /> : (
          <ResponsiveContainer width="100%" height={360}>
            <ChartCmp data={daily.data.series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
              <RTooltip content={<Tooltip />} labelFormatter={fmtDate} cursor={{ fill: 'var(--bg)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {daily.data.keys.map((k, i) => chart === 'line'
                ? <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />
                : <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} radius={i === daily.data.keys.length - 1 ? [3, 3, 0, 0] : 0} />)}
            </ChartCmp>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Breakdown" subtitle={`${rows.length} groups`}>
        {breakdown.loading ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th className="sortable" onClick={() => toggleSort('key')}>{GROUPS.find((g) => g[0] === groupBy)[1]} {sort.key === 'key' && (sort.dir === 'asc' ? '↑' : '↓')}</th>
                <th style={{ width: '40%' }}>Share</th>
                <th className="right sortable" onClick={() => toggleSort('cost')}>Cost {sort.key === 'cost' && (sort.dir === 'asc' ? '↑' : '↓')}</th>
                <th className="right">Per day</th>
                <th className="right">% of total</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td><span className="row"><span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />{r.key}</span></td>
                    <td><div className="progress"><div className="progress-bar tone-blue" style={{ width: `${total ? (r.cost / total) * 100 : 0}%` }} /></div></td>
                    <td className="right"><strong>{fmtMoney2(r.cost)}</strong></td>
                    <td className="right muted">{fmtMoney2(r.cost / days)}</td>
                    <td className="right">{total ? ((r.cost / total) * 100).toFixed(1) : 0}%</td>
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
