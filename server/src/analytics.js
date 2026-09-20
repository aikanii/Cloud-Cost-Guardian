import { q } from './db.js';
import {
  addDays, isoDate, todayIso, startOfMonth, daysInMonth, periodRange,
  daysBetween, round2, mean, stddev, linearRegression, parseTag, HttpError,
} from './util.js';

/* ------------------------------------------------------------------ */
/* Filtering helpers                                                   */
/* ------------------------------------------------------------------ */

export function buildFilter(f = {}) {
  const where = [];
  const params = [];
  if (f.start) { where.push('c.date >= ?'); params.push(f.start); }
  if (f.end) { where.push('c.date <= ?'); params.push(f.end); }
  if (f.accountId) { where.push('c.account_id = ?'); params.push(Number(f.accountId)); }
  if (f.provider) { where.push('a.provider = ?'); params.push(f.provider); }
  if (f.service) { where.push('c.service = ?'); params.push(f.service); }
  if (f.region) { where.push('c.region = ?'); params.push(f.region); }
  if (f.tag) {
    const t = parseTag(f.tag);
    if (!t) throw new HttpError(400, 'tag filter must be key=value');
    where.push("json_extract(c.tags, '$.' || ?) = ?");
    params.push(t.key, t.value);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const FROM = 'FROM cost_entries c JOIN accounts a ON a.id = c.account_id';

export function costTotal(f) {
  const { sql, params } = buildFilter(f);
  return round2(q.get(`SELECT COALESCE(SUM(c.cost),0) AS total ${FROM} ${sql}`, ...params).total);
}

export function costByDay(f) {
  const { sql, params } = buildFilter(f);
  return q.all(`SELECT c.date, ROUND(SUM(c.cost),2) AS cost ${FROM} ${sql} GROUP BY c.date ORDER BY c.date`, ...params);
}

const GROUP_COLS = {
  service: 'c.service',
  region: 'c.region',
  account: 'a.name',
  provider: 'a.provider',
  team: "COALESCE(json_extract(c.tags,'$.team'),'(untagged)')",
  env: "COALESCE(json_extract(c.tags,'$.env'),'(untagged)')",
  'cost-center': "COALESCE(json_extract(c.tags,'$.\"cost-center\"'),'(untagged)')",
};

export function costGrouped(groupBy, f) {
  const col = GROUP_COLS[groupBy];
  if (!col) throw new HttpError(400, `groupBy must be one of ${Object.keys(GROUP_COLS).join(', ')}`);
  const { sql, params } = buildFilter(f);
  return q.all(`SELECT ${col} AS key, ROUND(SUM(c.cost),2) AS cost ${FROM} ${sql} GROUP BY key ORDER BY cost DESC`, ...params);
}

export function costByDayGrouped(groupBy, f, limit = 6) {
  const col = GROUP_COLS[groupBy];
  if (!col) throw new HttpError(400, 'invalid groupBy');
  const { sql, params } = buildFilter(f);
  const top = costGrouped(groupBy, f).slice(0, limit).map((r) => r.key);
  const rows = q.all(`SELECT c.date, ${col} AS key, ROUND(SUM(c.cost),2) AS cost ${FROM} ${sql} GROUP BY c.date, key ORDER BY c.date`, ...params);
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, Other: 0 });
    const o = byDate.get(r.date);
    if (top.includes(r.key)) o[r.key] = round2((o[r.key] || 0) + r.cost);
    else o.Other = round2(o.Other + r.cost);
  }
  return { keys: [...top, 'Other'], series: [...byDate.values()] };
}

/* ------------------------------------------------------------------ */
/* Summary / KPIs                                                      */
/* ------------------------------------------------------------------ */

export function summary(f = {}) {
  const now = new Date();
  const today = todayIso();
  const mStart = isoDate(startOfMonth(now));
  const prevStart = isoDate(startOfMonth(addDays(startOfMonth(now), -1)));
  const prevEnd = isoDate(addDays(startOfMonth(now), -1));
  const base = { ...f };
  delete base.start; delete base.end;

  const mtd = costTotal({ ...base, start: mStart, end: today });
  const dayOfMonth = now.getUTCDate();
  const prevSamePeriod = costTotal({ ...base, start: prevStart, end: isoDate(addDays(new Date(prevStart), dayOfMonth - 1)) });
  const prevMonthTotal = costTotal({ ...base, start: prevStart, end: prevEnd });
  const last7 = costTotal({ ...base, start: isoDate(addDays(now, -6)), end: today });
  const prior7 = costTotal({ ...base, start: isoDate(addDays(now, -13)), end: isoDate(addDays(now, -7)) });
  const last30 = costTotal({ ...base, start: isoDate(addDays(now, -29)), end: today });
  const fc = forecast({ ...base });

  const pct = (a, b) => (b > 0 ? round2(((a - b) / b) * 100) : null);
  return {
    asOf: today,
    monthToDate: mtd,
    prevMonthSamePeriod: prevSamePeriod,
    monthToDateChangePct: pct(mtd, prevSamePeriod),
    prevMonthTotal,
    last7Days: last7,
    last7ChangePct: pct(last7, prior7),
    last30Days: last30,
    dailyAverage30d: round2(last30 / 30),
    forecastMonthEnd: fc.projectedMonthEnd,
    forecastChangePct: pct(fc.projectedMonthEnd, prevMonthTotal),
    openAlerts: q.get("SELECT COUNT(*) AS n FROM alerts WHERE status='open'").n,
    potentialSavings: round2(recommendations().reduce((s, r) => s + r.monthlySavings, 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

export function forecast(f = {}, horizonDays = 30) {
  const now = new Date();
  const today = todayIso();
  const histStart = isoDate(addDays(now, -59));
  const daily = costByDay({ ...f, start: histStart, end: today });
  const ys = daily.map((d) => d.cost);
  const { slope, intercept } = linearRegression(ys);
  const n = ys.length;
  const residuals = ys.map((y, i) => y - (intercept + slope * i));
  const sigma = stddev(residuals);

  const points = daily.map((d) => ({ date: d.date, actual: d.cost }));
  const projections = [];
  for (let h = 1; h <= horizonDays; h++) {
    const x = n - 1 + h;
    const value = Math.max(0, intercept + slope * x);
    const band = 1.28 * sigma * Math.sqrt(1 + h / Math.max(n, 1)); // ~80% interval widening with horizon
    projections.push({ date: isoDate(addDays(now, h)), forecast: round2(value), low: round2(Math.max(0, value - band)), high: round2(value + band) });
  }

  // Month-end projection: MTD actual + sum of forecast for remaining days
  const mStart = isoDate(startOfMonth(now));
  const mtd = costTotal({ ...f, start: mStart, end: today });
  const remaining = daysInMonth(now) - now.getUTCDate();
  let projectedRemaining = 0;
  for (let h = 1; h <= remaining; h++) projectedRemaining += Math.max(0, intercept + slope * (n - 1 + h));

  return {
    history: points,
    projections,
    trendPerDay: round2(slope),
    dailyRunRate: round2(mean(ys.slice(-7))),
    projectedMonthEnd: round2(mtd + projectedRemaining),
    monthToDate: mtd,
    projectedNext30Days: round2(projections.reduce((s, p) => s + p.forecast, 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Anomaly detection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Detects cost anomalies per (account, service) using a rolling baseline:
 * compares each day of the last `lookback` days to the mean/stddev of the
 * preceding `window` days. Flags when z-score > threshold AND relative
 * increase > minPct AND absolute delta > minAbs.
 */
export function detectAnomalies({ lookback = 14, window = 21, zThreshold = 3, minPct = 40, minAbs = 25 } = {}) {
  const now = new Date();
  const start = isoDate(addDays(now, -(lookback + window)));
  const rows = q.all(
    `SELECT c.account_id, a.name AS account, a.provider, c.service, c.date, SUM(c.cost) AS cost
     FROM cost_entries c JOIN accounts a ON a.id = c.account_id
     WHERE c.date >= ? GROUP BY c.account_id, c.service, c.date ORDER BY c.date`, start,
  );
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.account_id}|${r.service}`;
    if (!groups.has(k)) groups.set(k, { account_id: r.account_id, account: r.account, provider: r.provider, service: r.service, days: [] });
    groups.get(k).days.push({ date: r.date, cost: r.cost });
  }

  const anomalies = [];
  for (const g of groups.values()) {
    const d = g.days;
    for (let i = window; i < d.length; i++) {
      const base = d.slice(i - window, i).map((x) => x.cost);
      const m = mean(base);
      const sd = stddev(base);
      const cur = d[i].cost;
      const z = sd > 0 ? (cur - m) / sd : cur > m * 1.5 ? 10 : 0;
      const pctInc = m > 0 ? ((cur - m) / m) * 100 : 0;
      if (z > zThreshold && pctInc > minPct && cur - m > minAbs) {
        anomalies.push({
          id: `${g.account_id}|${g.service}|${d[i].date}`,
          accountId: g.account_id, account: g.account, provider: g.provider, service: g.service,
          date: d[i].date, cost: round2(cur), expected: round2(m), delta: round2(cur - m),
          pctIncrease: round2(pctInc), zScore: round2(z),
          severity: pctInc > 150 ? 'critical' : 'warning',
        });
      }
    }
  }
  return anomalies.sort((a, b) => b.delta - a.delta);
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

const RIGHTSIZE_MAP = {
  'm5.xlarge': 'm5.large', 'c5.2xlarge': 'c5.xlarge', 'm5.large': 't3.large', 'r5.large': 'r5.large→m5.large',
  'db.r5.large': 'db.t3.large', 'db.m5.xlarge': 'db.m5.large', 'n2-standard-8': 'n2-standard-4', 'n2-standard-4': 'n2-standard-2',
  'Standard_D4s_v3': 'Standard_D2s_v3', 'Standard_E8s_v3': 'Standard_E4s_v3', 'cache.r5.large': 'cache.t3.medium',
};

export function recommendations({ includeHandled = false } = {}) {
  const now = new Date();
  const start = isoDate(addDays(now, -29));
  const res = q.all(
    `SELECT r.*, a.name AS account, a.provider, COALESCE(SUM(c.cost),0) AS cost30
     FROM resources r JOIN accounts a ON a.id = r.account_id
     LEFT JOIN cost_entries c ON c.resource_id = r.id AND c.date >= ?
     GROUP BY r.id`, start,
  );
  const actions = new Map(q.all('SELECT * FROM recommendation_actions').map((a) => [a.fingerprint, a]));
  const out = [];
  const push = (rec) => {
    const action = actions.get(rec.fingerprint);
    if (action && !includeHandled) return;
    out.push({ ...rec, monthlySavings: round2(rec.monthlySavings), status: action?.status || 'open' });
  };

  for (const r of res) {
    const monthly = r.cost30;
    const base = { resourceId: r.resource_id, resourceName: r.name, account: r.account, accountId: r.account_id, provider: r.provider, service: r.service, region: r.region, instanceType: r.type, monthlyCost: round2(monthly) };
    if (r.status === 'unattached') {
      push({ ...base, fingerprint: `unattached|${r.id}`, type: 'unused', title: `Delete unattached ${r.service} volume`, description: `${r.name} is not attached to any instance but still incurs ${fmt(monthly)}/month.`, monthlySavings: monthly, effort: 'low', risk: 'low' });
    } else if (r.avg_cpu != null && r.avg_cpu < 5) {
      push({ ...base, fingerprint: `idle|${r.id}`, type: 'idle', title: `Stop or terminate idle ${r.service} instance`, description: `${r.name} averaged ${r.avg_cpu}% CPU over the last 30 days. Consider stopping it or scheduling it off-hours.`, monthlySavings: monthly * 0.95, effort: 'low', risk: 'medium' });
    } else if (r.avg_cpu != null && r.avg_cpu < 30 && RIGHTSIZE_MAP[r.type]) {
      push({ ...base, fingerprint: `rightsize|${r.id}`, type: 'rightsize', title: `Rightsize ${r.type} → ${RIGHTSIZE_MAP[r.type]}`, description: `${r.name} averages ${r.avg_cpu}% CPU. Downsizing one tier would save roughly half its compute cost.`, monthlySavings: monthly * 0.45, effort: 'medium', risk: 'medium' });
    }
    const tags = JSON.parse(r.tags || '{}');
    if (!tags.team && monthly > 50) {
      push({ ...base, fingerprint: `untagged|${r.id}`, type: 'governance', title: `Add missing "team" tag`, description: `${r.name} (${fmt(monthly)}/month) has no owner tag, preventing accurate chargeback.`, monthlySavings: 0, effort: 'low', risk: 'low' });
    }
  }

  // Commitment discounts: stable compute spend → savings plans / reserved instances
  const stable = q.all(
    `SELECT a.id AS account_id, a.name AS account, a.provider, c.service, SUM(c.cost) AS cost30
     FROM cost_entries c JOIN accounts a ON a.id = c.account_id
     WHERE c.date >= ? AND c.service IN ('EC2','RDS','Compute Engine','Virtual Machines','Azure SQL','Cloud SQL')
     GROUP BY a.id, c.service HAVING cost30 > 2000`, start,
  );
  for (const s of stable) {
    const label = s.provider === 'aws' ? 'Savings Plan' : s.provider === 'gcp' ? 'Committed Use Discount' : 'Reserved Instances';
    push({ resourceId: null, resourceName: `${s.service} fleet`, account: s.account, accountId: s.account_id, provider: s.provider, service: s.service, region: 'all', instanceType: null, monthlyCost: round2(s.cost30), fingerprint: `commit|${s.account_id}|${s.service}`, type: 'commitment', title: `Purchase 1-year ${label} for ${s.service}`, description: `${s.service} in ${s.account} has steady on-demand spend of ${fmt(s.cost30)}/month. A 1-year commitment covering ~70% of baseline typically saves 25-30%.`, monthlySavings: s.cost30 * 0.7 * 0.28, effort: 'medium', risk: 'low' });
  }

  // Storage tiering
  const storage = q.all(
    `SELECT a.id AS account_id, a.name AS account, a.provider, c.service, SUM(c.cost) AS cost30
     FROM cost_entries c JOIN accounts a ON a.id = c.account_id
     WHERE c.date >= ? AND c.service IN ('S3','Cloud Storage','Blob Storage') GROUP BY a.id, c.service HAVING cost30 > 300`, start,
  );
  for (const s of storage) {
    push({ resourceId: null, resourceName: `${s.service} buckets`, account: s.account, accountId: s.account_id, provider: s.provider, service: s.service, region: 'all', instanceType: null, monthlyCost: round2(s.cost30), fingerprint: `tier|${s.account_id}|${s.service}`, type: 'storage', title: `Enable lifecycle tiering on ${s.service}`, description: `Move objects not accessed in 30+ days to an infrequent-access / archive tier. Typical savings 20% of storage spend.`, monthlySavings: s.cost30 * 0.2, effort: 'low', risk: 'low' });
  }

  return out.sort((a, b) => b.monthlySavings - a.monthlySavings);
}

function fmt(n) {
  return `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export function budgetFilter(b) {
  const f = {};
  if (b.scope_type === 'account') f.accountId = b.scope_value;
  if (b.scope_type === 'service') f.service = b.scope_value;
  if (b.scope_type === 'tag') f.tag = b.scope_value;
  return f;
}

export function budgetStatus(b) {
  const now = new Date();
  const [start, end] = periodRange(b.period, now);
  const today = todayIso();
  const f = budgetFilter(b);
  const spent = costTotal({ ...f, start, end: today });
  const elapsed = daysBetween(start, today) + 1;
  const total = daysBetween(start, end) + 1;
  const runRate = elapsed > 0 ? spent / elapsed : 0;
  const projected = round2(runRate * total);
  const pctUsed = round2((spent / b.amount) * 100);
  let status = 'ok';
  if (spent > b.amount) status = 'exceeded';
  else if (pctUsed >= b.threshold_pct) status = 'warning';
  else if (projected > b.amount) status = 'at-risk';
  return {
    ...b, periodStart: start, periodEnd: end, spent, remaining: round2(b.amount - spent),
    pctUsed, projected, projectedPct: round2((projected / b.amount) * 100), status,
    daysElapsed: elapsed, daysTotal: total,
    scopeLabel: scopeLabel(b),
  };
}

function scopeLabel(b) {
  if (b.scope_type === 'all') return 'All spend';
  if (b.scope_type === 'account') {
    const a = q.get('SELECT name FROM accounts WHERE id = ?', Number(b.scope_value));
    return a ? `Account: ${a.name}` : `Account #${b.scope_value}`;
  }
  if (b.scope_type === 'service') return `Service: ${b.scope_value}`;
  return `Tag: ${b.scope_value}`;
}

/* ------------------------------------------------------------------ */
/* Alert evaluation                                                    */
/* ------------------------------------------------------------------ */

export function evaluateAlerts() {
  const created = [];
  const upsert = (a) => {
    const r = q.run(
      `INSERT INTO alerts(type, severity, title, message, fingerprint, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET severity = excluded.severity, message = excluded.message,
         metadata = excluded.metadata, updated_at = datetime('now')
       WHERE alerts.status != 'resolved'`,
      a.type, a.severity, a.title, a.message, a.fingerprint, JSON.stringify(a.metadata || {}),
    );
    if (r.changes && r.lastInsertRowid && q.get('SELECT created_at = updated_at AS fresh FROM alerts WHERE id = ?', r.lastInsertRowid)?.fresh) created.push(a.fingerprint);
  };

  for (const b of q.all('SELECT * FROM budgets')) {
    const s = budgetStatus(b);
    const period = s.periodStart.slice(0, 7);
    if (s.status === 'exceeded') {
      upsert({ type: 'budget', severity: 'critical', title: `Budget "${b.name}" exceeded`, message: `Spent $${s.spent.toLocaleString()} of $${b.amount.toLocaleString()} (${s.pctUsed}%).`, fingerprint: `budget-exceeded|${b.id}|${period}`, metadata: { budgetId: b.id, ...s } });
    } else if (s.status === 'warning') {
      upsert({ type: 'budget', severity: 'warning', title: `Budget "${b.name}" at ${s.pctUsed}%`, message: `Threshold of ${b.threshold_pct}% reached. $${s.remaining.toLocaleString()} remaining for the period.`, fingerprint: `budget-threshold|${b.id}|${period}`, metadata: { budgetId: b.id, ...s } });
    } else if (s.status === 'at-risk') {
      upsert({ type: 'forecast', severity: 'info', title: `Budget "${b.name}" forecast to exceed`, message: `Current run rate projects $${s.projected.toLocaleString()} (${s.projectedPct}% of budget) by ${s.periodEnd}.`, fingerprint: `budget-forecast|${b.id}|${period}`, metadata: { budgetId: b.id, ...s } });
    }
  }

  for (const an of detectAnomalies()) {
    upsert({ type: 'anomaly', severity: an.severity, title: `${an.service} spend spike in ${an.account}`, message: `${an.date}: $${an.cost.toLocaleString()} vs expected $${an.expected.toLocaleString()} (+${an.pctIncrease}%, z=${an.zScore}).`, fingerprint: `anomaly|${an.id}`, metadata: an });
  }
  return { created: created.length, total: q.get("SELECT COUNT(*) AS n FROM alerts WHERE status='open'").n };
}

/* ------------------------------------------------------------------ */
/* Governance / tag compliance                                         */
/* ------------------------------------------------------------------ */

export function tagCompliance(requiredTags = ['env', 'team', 'cost-center']) {
  const start = isoDate(addDays(new Date(), -29));
  const res = q.all(
    `SELECT r.*, a.name AS account, a.provider, COALESCE(SUM(c.cost),0) AS cost30
     FROM resources r JOIN accounts a ON a.id = r.account_id
     LEFT JOIN cost_entries c ON c.resource_id = r.id AND c.date >= ? GROUP BY r.id`, start,
  );
  let compliant = 0; let taggedCost = 0; let totalCost = 0;
  const violations = [];
  for (const r of res) {
    const tags = JSON.parse(r.tags || '{}');
    const missing = requiredTags.filter((t) => !tags[t]);
    totalCost += r.cost30;
    if (missing.length === 0) { compliant++; taggedCost += r.cost30; } else violations.push({ resourceId: r.resource_id, name: r.name, account: r.account, provider: r.provider, service: r.service, missing, monthlyCost: round2(r.cost30) });
  }
  return { requiredTags, totalResources: res.length, compliantResources: compliant, compliancePct: res.length ? round2((compliant / res.length) * 100) : 100, costCoveragePct: totalCost ? round2((taggedCost / totalCost) * 100) : 100, violations: violations.sort((a, b) => b.monthlyCost - a.monthlyCost) };
}
