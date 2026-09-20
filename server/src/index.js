import { createApp } from './app.js';
import { getDb, q } from './db.js';
import { seed } from './seed.js';
import { evaluateAlerts } from './analytics.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

getDb();
if (q.get('SELECT COUNT(*) AS n FROM accounts').n === 0) {
  console.log('Empty database – seeding demo data…');
  seed();
}

const run = () => {
  try {
    const r = evaluateAlerts();
    console.log(`[alerts] evaluated – ${r.total} open`);
  } catch (e) {
    console.error('[alerts] evaluation failed', e);
  }
};
run();
const interval = setInterval(run, Number(process.env.ALERT_INTERVAL_MS) || 15 * 60 * 1000);
interval.unref();

const app = createApp();
app.listen(PORT, HOST, () => console.log(`Cloud Cost Guardian API listening on http://${HOST}:${PORT}`));
