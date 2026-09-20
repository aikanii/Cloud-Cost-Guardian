import { getDb, q, transaction } from './db.js';
import { isoDate, addDays } from './util.js';

// Deterministic PRNG so demo data is reproducible.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCOUNTS = [
  { name: 'Production (AWS)', provider: 'aws', external_id: '123456789012' },
  { name: 'Staging (AWS)', provider: 'aws', external_id: '210987654321' },
  { name: 'Analytics (GCP)', provider: 'gcp', external_id: 'analytics-prod-4821' },
  { name: 'Corporate IT (Azure)', provider: 'azure', external_id: 'c0ffee00-1234-4abc-9def-000000000001' },
];

const CATALOG = {
  aws: {
    regions: ['us-east-1', 'us-west-2', 'eu-west-1'],
    services: [
      { service: 'EC2', types: ['m5.large', 'm5.xlarge', 'c5.2xlarge', 't3.medium', 'r5.large'], weight: 0.38, usage: 'BoxUsage' },
      { service: 'RDS', types: ['db.r5.large', 'db.m5.xlarge', 'db.t3.medium'], weight: 0.18, usage: 'InstanceUsage' },
      { service: 'S3', types: ['Standard', 'Standard-IA'], weight: 0.10, usage: 'TimedStorage-ByteHrs' },
      { service: 'Lambda', types: ['Function'], weight: 0.05, usage: 'Request' },
      { service: 'EBS', types: ['gp3', 'gp2', 'io1'], weight: 0.08, usage: 'VolumeUsage' },
      { service: 'CloudFront', types: ['Distribution'], weight: 0.06, usage: 'DataTransfer-Out' },
      { service: 'EKS', types: ['Cluster'], weight: 0.09, usage: 'ClusterHours' },
      { service: 'ElastiCache', types: ['cache.r5.large', 'cache.t3.small'], weight: 0.06, usage: 'NodeUsage' },
    ],
  },
  gcp: {
    regions: ['us-central1', 'europe-west1'],
    services: [
      { service: 'Compute Engine', types: ['n2-standard-4', 'n2-standard-8', 'e2-medium'], weight: 0.35, usage: 'Instance Core' },
      { service: 'BigQuery', types: ['Analysis'], weight: 0.30, usage: 'Bytes Scanned' },
      { service: 'Cloud Storage', types: ['Standard', 'Nearline'], weight: 0.12, usage: 'Storage' },
      { service: 'GKE', types: ['Cluster'], weight: 0.15, usage: 'Cluster Hours' },
      { service: 'Cloud SQL', types: ['db-n1-standard-2'], weight: 0.08, usage: 'Instance' },
    ],
  },
  azure: {
    regions: ['eastus', 'westeurope'],
    services: [
      { service: 'Virtual Machines', types: ['Standard_D4s_v3', 'Standard_B2ms', 'Standard_E8s_v3'], weight: 0.40, usage: 'Compute Hours' },
      { service: 'Azure SQL', types: ['GP_Gen5_4'], weight: 0.20, usage: 'vCore' },
      { service: 'Blob Storage', types: ['Hot', 'Cool'], weight: 0.12, usage: 'Data Stored' },
      { service: 'App Service', types: ['P1v3', 'S1'], weight: 0.15, usage: 'Hours' },
      { service: 'Managed Disks', types: ['Premium SSD', 'Standard SSD'], weight: 0.13, usage: 'Disk' },
    ],
  },
};

const TEAMS = ['platform', 'data', 'web', 'mobile', 'security'];
const ENVS = { 'Production (AWS)': 'prod', 'Staging (AWS)': 'staging', 'Analytics (GCP)': 'prod', 'Corporate IT (Azure)': 'prod' };
const ACCOUNT_SCALE = { 'Production (AWS)': 1400, 'Staging (AWS)': 380, 'Analytics (GCP)': 720, 'Corporate IT (Azure)': 520 };

export function seed({ days = 120, log = console.log } = {}) {
  getDb();
  const rand = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  transaction(() => {
    q.run('DELETE FROM cost_entries');
    q.run('DELETE FROM resources');
    q.run('DELETE FROM alerts');
    q.run('DELETE FROM recommendation_actions');
    q.run('DELETE FROM budgets');
    q.run('DELETE FROM accounts');

    const today = new Date();
    const start = addDays(today, -(days - 1));

    for (const acct of ACCOUNTS) {
      const { lastInsertRowid: accountId } = q.run(
        'INSERT INTO accounts(name, provider, external_id) VALUES (?, ?, ?)',
        acct.name, acct.provider, acct.external_id,
      );
      const cat = CATALOG[acct.provider];
      const dailyBase = ACCOUNT_SCALE[acct.name];
      const env = ENVS[acct.name];

      // Build resources
      const resources = [];
      let rIdx = 0;
      for (const svc of cat.services) {
        const count = svc.service.match(/S3|Storage|Blob|Lambda|BigQuery|CloudFront/) ? 2 : 4;
        const svcDaily = dailyBase * svc.weight;
        for (let i = 0; i < count; i++) {
          rIdx++;
          const isIdle = rand() < 0.14 && /EC2|Compute|Virtual|RDS|SQL|Cache/.test(svc.service);
          const isStopped = !isIdle && rand() < 0.06 && /EBS|Disks/.test(svc.service);
          const avgCpu = isIdle ? +(rand() * 4 + 0.5).toFixed(1) : /EC2|Compute|Virtual|RDS|SQL|Cache|EKS|GKE|App/.test(svc.service) ? +(rand() * 55 + 15).toFixed(1) : null;
          const tags = { env, team: pick(TEAMS), 'cost-center': `cc-${100 + Math.floor(rand() * 5)}` };
          if (rand() < 0.15) delete tags.team; // untagged resources for governance checks
          const share = (1 / count) * (0.6 + rand() * 0.8);
          const { lastInsertRowid: id } = q.run(
            `INSERT INTO resources(account_id, resource_id, name, service, region, type, tags, status, avg_cpu)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            accountId,
            `${acct.provider}-${svc.service.toLowerCase().replace(/\s+/g, '')}-${String(rIdx).padStart(3, '0')}`,
            `${svc.service.toLowerCase().replace(/\s+/g, '-')}-${env}-${i + 1}`,
            svc.service, pick(cat.regions), pick(svc.types), JSON.stringify(tags),
            isStopped ? 'unattached' : 'running', avgCpu,
          );
          resources.push({ id, svc, dailyCost: svcDaily * share, tags, isIdle });
        }
      }

      // Anomaly injections (per account)
      const anomalies = [];
      if (acct.name === 'Production (AWS)') anomalies.push({ dayOffset: days - 4, len: 2, factor: 3.2, service: 'EC2' });
      if (acct.name === 'Analytics (GCP)') anomalies.push({ dayOffset: days - 9, len: 1, factor: 4.5, service: 'BigQuery' });
      if (acct.name === 'Corporate IT (Azure)') anomalies.push({ dayOffset: days - 2, len: 2, factor: 2.4, service: 'Virtual Machines' });

      const insert = getDb().prepare(
        `INSERT INTO cost_entries(account_id, resource_id, date, service, region, usage_type, usage_quantity, cost, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (let d = 0; d < days; d++) {
        const date = addDays(start, d);
        const dow = date.getUTCDay();
        const weekend = dow === 0 || dow === 6;
        const growth = 1 + (d / days) * 0.18; // gentle upward trend
        for (const r of resources) {
          let cost = r.dailyCost * growth * (0.92 + rand() * 0.16);
          if (weekend && /Lambda|BigQuery|CloudFront|App Service/.test(r.svc.service)) cost *= 0.55;
          if (r.isIdle) cost *= 1.0;
          for (const a of anomalies) {
            if (a.service === r.svc.service && d >= a.dayOffset && d < a.dayOffset + a.len) cost *= a.factor;
          }
          const usage = r.svc.usage.match(/Request|Bytes/) ? cost * 1e6 : cost / 0.096;
          insert.run(accountId, r.id, isoDate(date), r.svc.service, pick(cat.regions), r.svc.usage, +usage.toFixed(2), +cost.toFixed(4), JSON.stringify(r.tags));
        }
      }
    }

    q.run(`INSERT INTO budgets(name, amount, period, scope_type, scope_value, threshold_pct) VALUES
      ('Total cloud spend', 95000, 'monthly', 'all', NULL, 80),
      ('AWS Production', 45000, 'monthly', 'account', '1', 85),
      ('BigQuery', 6000, 'monthly', 'service', 'BigQuery', 75),
      ('Data team', 20000, 'monthly', 'tag', 'team=data', 80)`);
  });

  const n = q.get('SELECT COUNT(*) AS n FROM cost_entries').n;
  log(`Seeded ${ACCOUNTS.length} accounts, ${q.get('SELECT COUNT(*) AS n FROM resources').n} resources, ${n} cost entries over ${days} days.`);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed();
}
