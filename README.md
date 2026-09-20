# Cloud Cost Guardian

A self-hosted, multi-cloud **FinOps dashboard** that gives you visibility and control over AWS, Azure and GCP spend:

- **Overview dashboard** – month-to-date, forecasted month-end, 7/30-day trends, spend by provider/service, budget health, open alerts and top savings.
- **Cost Explorer** – slice daily spend by service, account, provider, region or tag (team / env / cost-center), with stacked or line charts, sortable breakdowns and CSV export.
- **Forecasting** – least-squares trend projection with an 80 % confidence band and month-end estimate; works with any filter.
- **Budgets** – monthly / quarterly / yearly budgets scoped to all spend, an account, a service or a tag, with thresholds, run-rate projection and status (ok · at-risk · warning · exceeded).
- **Alerts** – automatic evaluation (on start, every 15 min, or on demand) of budget thresholds, forecast overruns and **statistical anomaly detection** (rolling 21-day z-score per account+service). Acknowledge / resolve / reopen lifecycle; alerts never re-open once handled.
- **Savings recommendations** – idle instances, unattached volumes, rightsizing, commitment discounts (Savings Plans / CUDs / RIs), storage tiering and missing-tag governance, each with estimated monthly savings, effort and risk. Mark as applied or dismissed.
- **Resources** – inventory with 30-day cost, CPU utilisation, tags and status; inline tag/status editing with a per-resource cost sparkline.
- **Tag governance** – compliance % against a configurable required-tag policy, cost coverage, and a violation list.
- **Accounts** – connect/disconnect AWS, GCP and Azure accounts; ingest billing data through the REST API.
- Dark mode, global provider/account filters, CSV exports and a fully documented JSON API.

The app ships with a deterministic **demo dataset** (4 accounts, ~86 resources, 120 days of costs including injected spikes and idle resources) so every feature is functional out of the box.

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Node 22, Express, built-in `node:sqlite` (no native build step) |
| Frontend | React 19, Vite, Recharts |
| Tests | `node:test` integration suite against the HTTP API |

## Getting started

Requires **Node ≥ 22.5** (for the built-in SQLite module).

```bash
npm run install:all        # installs server + client dependencies
npm run dev                # API on :4000, web UI on :5173 (proxied to the API)
```

Open http://localhost:5173. The database is created and seeded automatically on first start.

Other scripts:

```bash
npm test            # backend integration tests
npm run build       # production build of the client into client/dist
npm start           # serves API + built client from a single process on :4000
npm run seed        # regenerate demo data
npm run lint        # lint the client
```

### Docker

```bash
docker build -t cloud-cost-guardian .
docker run -p 4000:4000 -v ccg-data:/data cloud-cost-guardian
```

### Configuration (`server/.env.example`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | API port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `server/data/guardian.db` | SQLite file (`:memory:` for ephemeral) |
| `ALERT_INTERVAL_MS` | `900000` | Alert evaluation interval |

## Ingesting real billing data

Post normalised cost lines (e.g. from AWS CUR, Azure Cost Management exports or GCP billing BigQuery exports):

```bash
curl -X POST localhost:4000/api/costs/ingest -H 'content-type: application/json' -d '[
  { "accountId": 1, "date": "2026-09-20", "service": "EC2", "region": "us-east-1",
    "usageType": "BoxUsage", "usageQuantity": 24, "cost": 4.61, "tags": { "team": "web", "env": "prod" } }
]'
```

## API

All endpoints are under `/api`. Cost endpoints accept the filters `start`, `end` (or `days`), `accountId`, `provider`, `service`, `region`, `tag=key=value`.

| Method & path | Purpose |
|---------------|---------|
| `GET /health` | Liveness + entry count |
| `GET/POST/DELETE /accounts` | Cloud accounts |
| `GET /costs/summary` | KPI summary with period-over-period deltas |
| `GET /costs/daily` | Daily totals |
| `GET /costs/breakdown?groupBy=` | Totals by `service|account|provider|region|team|env|cost-center` |
| `GET /costs/daily-breakdown?groupBy=&limit=` | Daily stacked series (top N + Other) |
| `GET /costs/forecast?horizon=` | Trend forecast with confidence band |
| `GET /costs/export?format=csv|json` | Raw export |
| `GET /costs/filters` | Available filter values |
| `POST /costs/ingest` | Bulk insert |
| `GET /resources`, `GET /resources/:id/costs`, `PATCH /resources/:id` | Inventory |
| `GET/POST /budgets`, `PUT/DELETE /budgets/:id` | Budgets with live status |
| `GET /alerts`, `PATCH /alerts/:id`, `POST /alerts/evaluate` | Alert lifecycle |
| `GET /anomalies` | Anomaly detector output |
| `GET /recommendations`, `POST /recommendations/:fingerprint/:action` | Savings (`applied` / `dismissed` / `open`) |
| `GET /governance/tags` | Tag compliance |
| `GET/PUT /settings` | Required tags etc. |
| `POST /admin/reseed` | Regenerate demo data |

## Project layout

```
server/src/db.js         SQLite schema & helpers
server/src/seed.js       Deterministic demo data generator
server/src/analytics.js  Aggregations, forecast, anomaly detection, recommendations, budgets, alerts
server/src/app.js        Express API
server/test/             Integration tests
client/src/pages/        Dashboard, Explorer, Forecast, Budgets, Alerts, Savings, Resources, Governance, Accounts, Settings
client/src/components/   Shared UI primitives
client/src/lib/          API client, formatters, contexts
```

## License

MIT
