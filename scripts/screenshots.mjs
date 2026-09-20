// Usage: CHROME_PATH=/path/to/chrome node scripts/screenshots.mjs  (requires puppeteer-core; dev servers on :5173/:4000)
import puppeteer from 'puppeteer-core';
const OUT = new URL('../docs/screenshots', import.meta.url).pathname;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/tmp/chromium', headless: 'shell',
  env: process.env,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--font-render-hinting=none', '--hide-scrollbars', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
// block the Google Fonts import (unreachable) so it doesn't stall render
await page.setRequestInterception(true);
page.on('request', (r) => (/fonts\.googleapis|fonts\.gstatic/.test(r.url()) ? r.abort() : r.continue()));
const shots = [
  ['dashboard', '/'], ['explorer', '/explorer'], ['forecast', '/forecast'], ['budgets', '/budgets'],
  ['alerts', '/alerts'], ['savings', '/recommendations'], ['resources', '/resources'], ['governance', '/governance'],
];
await page.goto('http://localhost:5173/#/', { waitUntil: 'networkidle0', timeout: 60000 });
for (const [name, route] of shots) {
  await page.evaluate((r) => { window.location.hash = r; }, route);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.skeleton'), { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2600)); // let reveal + chart + count-up animations finish
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  const h = await page.evaluate(() => document.body.textContent.length);
  console.log('saved', name, `(${h} chars)`);
}
await browser.close();
