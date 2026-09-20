import { useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, Legend, ReferenceLine } from 'recharts';
import { useApi, qs, fmtMoney, fmtCompact, fmtDate } from '../lib/api.js';
import { Card, Kpi, Loading, ErrorState, Tooltip } from '../components/ui.jsx';
import { useGlobalFilters } from '../lib/context.js';

export default function Forecast() {
  const { filters } = useGlobalFilters();
  const [horizon, setHorizon] = useState(30);
  const fc = useApi(`/costs/forecast${qs({ ...filters, horizon })}`);
  if (fc.error) return <ErrorState error={fc.error} onRetry={fc.refetch} />;
  if (fc.loading) return <Loading />;
  const d = fc.data;
  const last = d.history[d.history.length - 1];
  const data = [
    ...d.history.map((h) => ({ date: h.date, Actual: h.actual })),
    ...(last ? [{ date: last.date, Actual: last.actual, Forecast: last.actual, band: [last.actual, last.actual] }] : []),
    ...d.projections.map((p) => ({ date: p.date, Forecast: p.forecast, band: [p.low, p.high] })),
  ];

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Forecast</h1><p className="muted">Linear-trend projection over the last 60 days with an 80% confidence band</p></div>
        <div className="segmented">{[14, 30, 60, 90].map((h) => <button key={h} className={horizon === h ? 'active' : ''} onClick={() => setHorizon(h)}>{h}d</button>)}</div>
      </div>
      <div className="grid grid-4">
        <Kpi label="Month to date" value={fmtMoney(d.monthToDate)} />
        <Kpi label="Projected month end" value={fmtMoney(d.projectedMonthEnd)} hint="MTD + projected remaining days" />
        <Kpi label="Daily run rate" value={fmtMoney(d.dailyRunRate)} hint="7-day average" />
        <Kpi label="Trend" value={`${d.trendPerDay >= 0 ? '+' : ''}${fmtMoney(d.trendPerDay)}/day`} delta={last?.actual ? (d.trendPerDay / last.actual) * 100 : null} deltaLabel="daily change rate" />
      </div>
      <Card title="Actual vs forecast" subtitle={`Next ${horizon} days projected total: ${fmtMoney(d.projectedNext30Days)}`}>
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
            <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} domain={[0, 'auto']} />
            <RTooltip content={<Tooltip />} labelFormatter={fmtDate} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="band" name="80% band" stroke="none" fill="var(--primary)" fillOpacity={0.12} legendType="none" tooltipType="none" />
            <Line type="monotone" dataKey="Actual" stroke="var(--primary)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Forecast" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" dot={false} />
            {last && <ReferenceLine x={last.date} stroke="var(--muted)" strokeDasharray="3 3" label={{ value: 'Today', fontSize: 11, fill: 'var(--muted)', position: 'insideTopRight' }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card title="How this works">
        <p className="muted">
          The forecast fits an ordinary least-squares line to the last 60 days of daily spend and extrapolates it forward. The shaded band is ±1.28σ of the
          historical residuals, widening with the horizon. Month-end projection = actual month-to-date + the sum of projected values for the remaining days.
          Use the global filters above to forecast a single provider or account.
        </p>
      </Card>
    </div>
  );
}
