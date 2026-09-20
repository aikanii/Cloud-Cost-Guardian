export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function todayIso() {
  return isoDate(new Date());
}

export function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function daysInMonth(d = new Date()) {
  return endOfMonth(d).getUTCDate();
}

/** Returns [start, end] ISO dates for a budget period containing `ref`. */
export function periodRange(period, ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  if (period === 'yearly') return [isoDate(Date.UTC(y, 0, 1)), isoDate(Date.UTC(y, 11, 31))];
  if (period === 'quarterly') {
    const qs = Math.floor(m / 3) * 3;
    return [isoDate(Date.UTC(y, qs, 1)), isoDate(Date.UTC(y, qs + 3, 0))];
  }
  return [isoDate(Date.UTC(y, m, 1)), isoDate(Date.UTC(y, m + 1, 0))];
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/** Simple least-squares linear regression over y values indexed 0..n-1. */
export function linearRegression(ys) {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0] };
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: yMean - slope * xMean };
}

/** Parse a "key=value" tag filter. */
export function parseTag(str) {
  if (!str || !str.includes('=')) return null;
  const i = str.indexOf('=');
  return { key: str.slice(0, i).trim(), value: str.slice(i + 1).trim() };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
