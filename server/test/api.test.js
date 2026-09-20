import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');
const { resetDb } = await import('../src/db.js');
const A = await import('../src/analytics.js');
const U = await import('../src/util.js');

let server; let base;
const api = async (path, opts = {}) => {
  const r = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};

before(async () => {
  seed({ days: 90, log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); resetDb(); });

test('util: linear regression and period ranges', () => {
  const { slope, intercept } = U.linearRegression([1, 2, 3, 4]);
  assert.ok(Math.abs(slope - 1) < 1e-9 && Math.abs(intercept - 1) < 1e-9);
  const [s, e] = U.periodRange('monthly', new Date('2026-02-10T00:00:00Z'));
  assert.equal(s, '2026-02-01'); assert.equal(e, '2026-02-28');
  const [qs, qe] = U.periodRange('quarterly', new Date('2026-11-10T00:00:00Z'));
  assert.equal(qs, '2026-10-01'); assert.equal(qe, '2026-12-31');
  assert.deepEqual(U.parseTag('team=data'), { key: 'team', value: 'data' });
  assert.equal(U.parseTag('bad'), null);
});

test('health and accounts', async () => {
  const h = await api('/health');
  assert.equal(h.status, 200); assert.ok(h.body.entries > 0);
  const a = await api('/accounts');
  assert.equal(a.body.length, 4);
  assert.ok(a.body.every((x) => x.cost30 > 0));
  const bad = await api('/accounts', { method: 'POST', body: { name: 'x', provider: 'oracle', external_id: '1' } });
  assert.equal(bad.status, 400);
});

test('cost summary, daily and breakdown are consistent', async () => {
  const s = await api('/costs/summary');
  assert.equal(s.status, 200);
  assert.ok(s.body.last30Days > 0 && s.body.forecastMonthEnd >= s.body.monthToDate);
  const d = await api('/costs/daily?days=30');
  assert.equal(d.body.length, 30);
  const sum = d.body.reduce((t, r) => t + r.cost, 0);
  assert.ok(Math.abs(sum - s.body.last30Days) < 1, `daily sum ${sum} vs ${s.body.last30Days}`);
  const b = await api('/costs/breakdown?groupBy=service&days=30');
  const bsum = b.body.reduce((t, r) => t + r.cost, 0);
  assert.ok(Math.abs(bsum - sum) < 1);
  const invalid = await api('/costs/breakdown?groupBy=nope');
  assert.equal(invalid.status, 400);
  const tagged = await api('/costs/breakdown?groupBy=service&days=30&tag=team=data');
  assert.equal(tagged.status, 200);
  const badTag = await api('/costs/daily?tag=team');
  assert.equal(badTag.status, 400);
});

test('forecast returns projections with bands', async () => {
  const f = await api('/costs/forecast?horizon=14');
  assert.equal(f.body.projections.length, 14);
  for (const p of f.body.projections) assert.ok(p.low <= p.forecast && p.forecast <= p.high);
});

test('anomalies detect injected spikes', () => {
  const an = A.detectAnomalies();
  assert.ok(an.length >= 3, `expected >=3 anomalies, got ${an.length}`);
  const services = new Set(an.map((a) => a.service));
  assert.ok(services.has('BigQuery'));
  assert.ok(services.has('EC2'));
});

test('recommendations include multiple types and are actionable', async () => {
  const r = await api('/recommendations');
  const types = new Set(r.body.map((x) => x.type));
  assert.ok(types.has('idle') && types.has('commitment') && types.has('storage'));
  const first = r.body[0];
  const d = await api(`/recommendations/${encodeURIComponent(first.fingerprint)}/dismissed`, { method: 'POST' });
  assert.equal(d.status, 200);
  const after = await api('/recommendations');
  assert.ok(!after.body.some((x) => x.fingerprint === first.fingerprint));
  const all = await api('/recommendations?all=true');
  assert.equal(all.body.find((x) => x.fingerprint === first.fingerprint).status, 'dismissed');
  await api(`/recommendations/${encodeURIComponent(first.fingerprint)}/open`, { method: 'POST' });
});

test('budgets CRUD + status + alerts', async () => {
  const bad = await api('/budgets', { method: 'POST', body: { name: 'x', amount: -5 } });
  assert.equal(bad.status, 400);
  const badTag = await api('/budgets', { method: 'POST', body: { name: 'x', amount: 5, scope_type: 'tag', scope_value: 'nope' } });
  assert.equal(badTag.status, 400);
  const c = await api('/budgets', { method: 'POST', body: { name: 'Tiny', amount: 10, scope_type: 'service', scope_value: 'EC2', threshold_pct: 50 } });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'exceeded');
  const alerts = await api('/alerts?type=budget');
  const mine = alerts.body.find((a) => a.metadata.budgetId === c.body.id);
  assert.ok(mine && mine.severity === 'critical');
  const ack = await api(`/alerts/${mine.id}`, { method: 'PATCH', body: { status: 'acknowledged' } });
  assert.equal(ack.body.status, 'acknowledged');
  // re-evaluation must not reopen an acknowledged alert
  await api('/alerts/evaluate', { method: 'POST' });
  const again = (await api('/alerts')).body.find((a) => a.id === mine.id);
  assert.equal(again.status, 'acknowledged');
  const up = await api(`/budgets/${c.body.id}`, { method: 'PUT', body: { amount: 10000000 } });
  assert.equal(up.body.status, 'ok');
  const del = await api(`/budgets/${c.body.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.ok(!(await api('/alerts')).body.some((a) => a.metadata.budgetId === c.body.id));
});

test('ingest, export and resources', async () => {
  const before = (await api('/health')).body.entries;
  const bad = await api('/costs/ingest', { method: 'POST', body: [{ accountId: 999, date: '2026-01-01', service: 'X', cost: 1 }] });
  assert.equal(bad.status, 400);
  const ok = await api('/costs/ingest', { method: 'POST', body: [{ accountId: 1, date: U.todayIso(), service: 'Custom', cost: 12.5, tags: { team: 'web' } }] });
  assert.equal(ok.status, 201);
  assert.equal((await api('/health')).body.entries, before + 1);
  const csv = await fetch(base + '/costs/export?days=2&service=Custom');
  assert.equal(csv.headers.get('content-type').split(';')[0], 'text/csv');
  const text = await csv.text();
  assert.ok(text.startsWith('date,account,provider,service'));
  assert.ok(text.includes('Custom'));
  const res = await api('/resources?q=ec2');
  assert.ok(res.body.length > 0 && typeof res.body[0].tags === 'object');
  const patched = await api(`/resources/${res.body[0].id}`, { method: 'PATCH', body: { tags: { ...res.body[0].tags, owner: 'me' } } });
  assert.equal(patched.body.tags.owner, 'me');
  const rc = await api(`/resources/${res.body[0].id}/costs?days=7`);
  assert.equal(rc.body.length, 7);
});

test('governance tag compliance and settings', async () => {
  const g = await api('/governance/tags');
  assert.ok(g.body.compliancePct < 100 && g.body.violations.length > 0);
  const s = await api('/settings', { method: 'PUT', body: { requiredTags: ['env'] } });
  assert.deepEqual(s.body.requiredTags, ['env']);
  const g2 = await api('/governance/tags');
  assert.equal(g2.body.compliancePct, 100);
  const nf = await api('/nothing');
  assert.equal(nf.status, 404);
});
