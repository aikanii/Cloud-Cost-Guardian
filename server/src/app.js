import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { q, transaction, getSetting, setSetting } from './db.js';
import * as A from './analytics.js';
import { HttpError, addDays, isoDate, todayIso, parseTag } from './util.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') r.catch(next);
  } catch (e) { next(e); }
};

function filtersFrom(query) {
  const f = {};
  for (const k of ['start', 'end', 'accountId', 'provider', 'service', 'region', 'tag']) if (query[k]) f[k] = query[k];
  if (!f.start && !f.end && query.days) {
    const d = Math.max(1, Math.min(365, Number(query.days) || 30));
    f.start = isoDate(addDays(new Date(), -(d - 1)));
    f.end = todayIso();
  }
  return f;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString(), entries: q.get('SELECT COUNT(*) AS n FROM cost_entries').n }));

  /* ---- Accounts ---- */
  api.get('/accounts', wrap((_req, res) => {
    const start = isoDate(addDays(new Date(), -29));
    res.json(q.all(`SELECT a.*, (SELECT COUNT(*) FROM resources r WHERE r.account_id = a.id) AS resources,
      (SELECT ROUND(COALESCE(SUM(cost),0),2) FROM cost_entries c WHERE c.account_id = a.id AND c.date >= ?) AS cost30 FROM accounts a ORDER BY cost30 DESC`, start));
  }));
  api.post('/accounts', wrap((req, res) => {
    const { name, provider, external_id, currency = 'USD' } = req.body || {};
    if (!name || !provider || !external_id) throw new HttpError(400, 'name, provider and external_id are required');
    if (!['aws', 'azure', 'gcp'].includes(provider)) throw new HttpError(400, 'provider must be aws, azure or gcp');
    const r = q.run('INSERT INTO accounts(name, provider, external_id, currency) VALUES (?,?,?,?)', name, provider, external_id, currency);
    res.status(201).json(q.get('SELECT * FROM accounts WHERE id = ?', r.lastInsertRowid));
  }));
  api.delete('/accounts/:id', wrap((req, res) => {
    const r = q.run('DELETE FROM accounts WHERE id = ?', Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'account not found');
    res.status(204).end();
  }));

  /* ---- Costs ---- */
  api.get('/costs/summary', wrap((req, res) => res.json(A.summary(filtersFrom(req.query)))));
  api.get('/costs/daily', wrap((req, res) => res.json(A.costByDay(filtersFrom(req.query)))));
  api.get('/costs/breakdown', wrap((req, res) => res.json(A.costGrouped(req.query.groupBy || 'service', filtersFrom(req.query)))));
  api.get('/costs/daily-breakdown', wrap((req, res) => res.json(A.costByDayGrouped(req.query.groupBy || 'service', filtersFrom(req.query), Number(req.query.limit) || 6))));
  api.get('/costs/forecast', wrap((req, res) => res.json(A.forecast(filtersFrom(req.query), Math.min(90, Number(req.query.horizon) || 30)))));
  api.get('/costs/filters', wrap((_req, res) => {
    res.json({
      services: q.all('SELECT DISTINCT service FROM cost_entries ORDER BY service').map((r) => r.service),
      regions: q.all('SELECT DISTINCT region FROM cost_entries ORDER BY region').map((r) => r.region),
      providers: q.all('SELECT DISTINCT provider FROM accounts ORDER BY provider').map((r) => r.provider),
      accounts: q.all('SELECT id, name, provider FROM accounts ORDER BY name'),
      tags: {
        team: q.all("SELECT DISTINCT json_extract(tags,'$.team') AS v FROM resources WHERE v IS NOT NULL ORDER BY v").map((r) => r.v),
        env: q.all("SELECT DISTINCT json_extract(tags,'$.env') AS v FROM resources WHERE v IS NOT NULL ORDER BY v").map((r) => r.v),
      },
    });
  }));
  api.get('/costs/export', wrap((req, res) => {
    const { sql, params } = A.buildFilter(filtersFrom(req.query));
    const rows = q.all(`SELECT c.date, a.name AS account, a.provider, c.service, c.region, r.name AS resource, c.usage_type, c.usage_quantity, ROUND(c.cost,4) AS cost, c.tags
      FROM cost_entries c JOIN accounts a ON a.id = c.account_id LEFT JOIN resources r ON r.id = c.resource_id ${sql} ORDER BY c.date, a.name, c.service`, ...params);
    if ((req.query.format || 'csv') === 'json') return res.json(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cloud-costs-${todayIso()}.csv"`);
    res.send(toCsv(rows));
  }));
  api.post('/costs/ingest', wrap((req, res) => {
    const entries = Array.isArray(req.body) ? req.body : req.body?.entries;
    if (!Array.isArray(entries) || !entries.length) throw new HttpError(400, 'body must be an array of cost entries');
    let n = 0;
    transaction(() => {
      for (const e of entries) {
        if (!e.accountId || !e.date || !e.service || e.cost == null) throw new HttpError(400, 'each entry needs accountId, date, service, cost');
        if (!q.get('SELECT 1 FROM accounts WHERE id = ?', Number(e.accountId))) throw new HttpError(400, `unknown accountId ${e.accountId}`);
        q.run('INSERT INTO cost_entries(account_id, date, service, region, usage_type, usage_quantity, cost, tags) VALUES (?,?,?,?,?,?,?,?)',
          Number(e.accountId), e.date, e.service, e.region || 'global', e.usageType || null, Number(e.usageQuantity) || 0, Number(e.cost), JSON.stringify(e.tags || {}));
        n++;
      }
    });
    res.status(201).json({ ingested: n });
  }));

  /* ---- Resources ---- */
  api.get('/resources', wrap((req, res) => {
    const start = isoDate(addDays(new Date(), -29));
    const where = []; const params = [start];
    if (req.query.accountId) { where.push('r.account_id = ?'); params.push(Number(req.query.accountId)); }
    if (req.query.service) { where.push('r.service = ?'); params.push(req.query.service); }
    if (req.query.provider) { where.push('a.provider = ?'); params.push(req.query.provider); }
    if (req.query.q) { where.push('(r.name LIKE ? OR r.resource_id LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const rows = q.all(`SELECT r.*, a.name AS account, a.provider, ROUND(COALESCE(SUM(c.cost),0),2) AS cost30
      FROM resources r JOIN accounts a ON a.id = r.account_id LEFT JOIN cost_entries c ON c.resource_id = r.id AND c.date >= ?
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY r.id ORDER BY cost30 DESC`, ...params);
    res.json(rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || '{}') })));
  }));
  api.get('/resources/:id/costs', wrap((req, res) => {
    const days = Math.min(365, Number(req.query.days) || 30);
    res.json(q.all('SELECT date, ROUND(SUM(cost),2) AS cost FROM cost_entries WHERE resource_id = ? AND date >= ? GROUP BY date ORDER BY date', Number(req.params.id), isoDate(addDays(new Date(), -(days - 1)))));
  }));
  api.patch('/resources/:id', wrap((req, res) => {
    const r = q.get('SELECT * FROM resources WHERE id = ?', Number(req.params.id));
    if (!r) throw new HttpError(404, 'resource not found');
    const tags = req.body?.tags && typeof req.body.tags === 'object' ? req.body.tags : JSON.parse(r.tags);
    const status = req.body?.status || r.status;
    q.run('UPDATE resources SET tags = ?, status = ? WHERE id = ?', JSON.stringify(tags), status, r.id);
    res.json({ ...q.get('SELECT * FROM resources WHERE id = ?', r.id), tags });
  }));

  /* ---- Budgets ---- */
  api.get('/budgets', wrap((_req, res) => res.json(q.all('SELECT * FROM budgets ORDER BY id').map(A.budgetStatus))));
  api.post('/budgets', wrap((req, res) => {
    const b = validateBudget(req.body);
    const r = q.run('INSERT INTO budgets(name, amount, period, scope_type, scope_value, threshold_pct) VALUES (?,?,?,?,?,?)', b.name, b.amount, b.period, b.scope_type, b.scope_value, b.threshold_pct);
    A.evaluateAlerts();
    res.status(201).json(A.budgetStatus(q.get('SELECT * FROM budgets WHERE id = ?', r.lastInsertRowid)));
  }));
  api.put('/budgets/:id', wrap((req, res) => {
    const existing = q.get('SELECT * FROM budgets WHERE id = ?', Number(req.params.id));
    if (!existing) throw new HttpError(404, 'budget not found');
    const b = validateBudget({ ...existing, ...req.body });
    q.run('UPDATE budgets SET name=?, amount=?, period=?, scope_type=?, scope_value=?, threshold_pct=? WHERE id=?', b.name, b.amount, b.period, b.scope_type, b.scope_value, b.threshold_pct, existing.id);
    A.evaluateAlerts();
    res.json(A.budgetStatus(q.get('SELECT * FROM budgets WHERE id = ?', existing.id)));
  }));
  api.delete('/budgets/:id', wrap((req, res) => {
    const r = q.run('DELETE FROM budgets WHERE id = ?', Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'budget not found');
    q.run("DELETE FROM alerts WHERE type IN ('budget','forecast') AND json_extract(metadata,'$.budgetId') = ?", Number(req.params.id));
    res.status(204).end();
  }));

  /* ---- Alerts ---- */
  api.get('/alerts', wrap((req, res) => {
    const where = []; const params = [];
    if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
    if (req.query.type) { where.push('type = ?'); params.push(req.query.type); }
    const rows = q.all(`SELECT * FROM alerts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC`, ...params);
    res.json(rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) })));
  }));
  api.post('/alerts/evaluate', wrap((_req, res) => res.json(A.evaluateAlerts())));
  api.patch('/alerts/:id', wrap((req, res) => {
    const { status } = req.body || {};
    if (!['open', 'acknowledged', 'resolved'].includes(status)) throw new HttpError(400, 'invalid status');
    const r = q.run("UPDATE alerts SET status = ?, updated_at = datetime('now') WHERE id = ?", status, Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'alert not found');
    const row = q.get('SELECT * FROM alerts WHERE id = ?', Number(req.params.id));
    res.json({ ...row, metadata: JSON.parse(row.metadata) });
  }));

  /* ---- Anomalies / recommendations / governance ---- */
  api.get('/anomalies', wrap((req, res) => res.json(A.detectAnomalies({ lookback: Number(req.query.lookback) || 14, zThreshold: Number(req.query.z) || 3 }))));
  api.get('/recommendations', wrap((req, res) => res.json(A.recommendations({ includeHandled: req.query.all === 'true' }))));
  api.post('/recommendations/:fingerprint/:action', wrap((req, res) => {
    const { fingerprint, action } = req.params;
    if (!['dismissed', 'applied', 'open'].includes(action)) throw new HttpError(400, 'action must be dismissed, applied or open');
    if (action === 'open') q.run('DELETE FROM recommendation_actions WHERE fingerprint = ?', fingerprint);
    else q.run("INSERT INTO recommendation_actions(fingerprint, status) VALUES (?, ?) ON CONFLICT(fingerprint) DO UPDATE SET status = excluded.status, updated_at = datetime('now')", fingerprint, action);
    res.json({ fingerprint, status: action });
  }));
  api.get('/governance/tags', wrap((req, res) => {
    const required = req.query.required ? String(req.query.required).split(',').map((s) => s.trim()).filter(Boolean) : getSetting('requiredTags', ['env', 'team', 'cost-center']);
    res.json(A.tagCompliance(required));
  }));

  /* ---- Settings / admin ---- */
  api.get('/settings', wrap((_req, res) => res.json({ requiredTags: getSetting('requiredTags', ['env', 'team', 'cost-center']), currency: getSetting('currency', 'USD'), anomalyZ: getSetting('anomalyZ', 3) })));
  api.put('/settings', wrap((req, res) => {
    const b = req.body || {};
    if (b.requiredTags) { if (!Array.isArray(b.requiredTags)) throw new HttpError(400, 'requiredTags must be an array'); setSetting('requiredTags', b.requiredTags); }
    if (b.currency) setSetting('currency', String(b.currency));
    if (b.anomalyZ != null) setSetting('anomalyZ', Number(b.anomalyZ));
    res.json({ requiredTags: getSetting('requiredTags'), currency: getSetting('currency'), anomalyZ: getSetting('anomalyZ') });
  }));
  api.post('/admin/reseed', wrap((_req, res) => { seed({ log: () => {} }); A.evaluateAlerts(); res.json({ ok: true }); }));

  app.use('/api', api);

  // Serve built client if present
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'internal error' });
  });
  return app;
}

function validateBudget(b = {}) {
  const amount = Number(b.amount);
  if (!b.name || !String(b.name).trim()) throw new HttpError(400, 'name is required');
  if (!(amount > 0)) throw new HttpError(400, 'amount must be a positive number');
  const period = b.period || 'monthly';
  if (!['monthly', 'quarterly', 'yearly'].includes(period)) throw new HttpError(400, 'invalid period');
  const scope_type = b.scope_type || 'all';
  if (!['all', 'account', 'service', 'tag'].includes(scope_type)) throw new HttpError(400, 'invalid scope_type');
  let scope_value = scope_type === 'all' ? null : String(b.scope_value ?? '').trim();
  if (scope_type !== 'all' && !scope_value) throw new HttpError(400, 'scope_value is required for this scope');
  if (scope_type === 'tag' && !parseTag(scope_value)) throw new HttpError(400, 'tag scope must be key=value');
  if (scope_type === 'account' && !q.get('SELECT 1 FROM accounts WHERE id = ?', Number(scope_value))) throw new HttpError(400, 'unknown account');
  const threshold_pct = b.threshold_pct == null ? 80 : Number(b.threshold_pct);
  if (!(threshold_pct > 0 && threshold_pct <= 100)) throw new HttpError(400, 'threshold_pct must be between 1 and 100');
  return { name: String(b.name).trim(), amount, period, scope_type, scope_value, threshold_pct };
}
