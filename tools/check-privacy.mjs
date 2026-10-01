// Dev-only end-to-end privacy check. NOT shipped to the browser, NOT an app dependency.
// Requires Playwright installed separately (e.g. `npm i -g playwright`), and the dev server
// running (`node tools/serve.mjs`). Run:  node tools/check-privacy.mjs
//
// It loads the app in Chromium, imports every sample file, walks all six steps, prints the
// report, and then asserts:
//   • no network request of any kind happened after the initial page load
//   • every request during load was same-origin
//   • no CSP violations, no JS errors, no alert() dialogs from hostile sample text
//   • localStorage, sessionStorage, IndexedDB, cookies, Cache API and service workers are empty
//   • "Clear all data" empties the in-memory state
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8000/';
const SAMPLES = fileURLToPath(new URL('../samples/', import.meta.url));
const OUT = process.env.OUT_DIR || null;

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext();
const page = await context.newPage();

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

const requests = [];
let loaded = false;
page.on('request', (r) => requests.push({ url: r.url(), afterLoad: loaded, type: r.resourceType() }));
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(`console.${m.type()}: ${m.text()}`); if (process.env.DEBUG) console.log('   [console]', m.text(), m.location()); } });
const dialogs = [];
page.on('dialog', async (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  // confirm() from our own UI ("Replace budget?" / "Clear all?") is expected; alert() never is.
  if (d.type() === 'confirm' || d.type() === 'beforeunload') await d.accept(); else await d.dismiss();
});
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});

await page.goto(BASE, { waitUntil: 'networkidle' });
loaded = true;
const loadRequests = requests.length;
console.log(`Initial load made ${loadRequests} requests:`);
for (const r of requests) console.log(`   ${r.type.padEnd(10)} ${r.url}`);
check(requests.every((r) => r.url.startsWith(BASE)), 'all initial-load requests are same-origin');
check(await page.evaluate(() => !!(globalThis.pdfjsLib && globalThis.pdfjsWorker)), 'PDF.js loaded via SRI script tags (fake-worker mode)');

const upload = async (names) => {
  await page.setInputFiles('#file-input', names.map((n) => join(SAMPLES, n)));
  await page.waitForTimeout(400);
};

// 1. Upload: recognized CSV / OFX / QFX files
await upload(['checking-jan-mar-2024.csv', 'checking-overlap-feb-mar-2024.csv', 'creditcard-positive-charges.csv', 'savings-2024q1.qfx', 'visa-card-2024q1.ofx']);
check(await page.locator('#files-panel tbody tr').count() === 5, 'five files imported');
// Bad files show errors and do not crash
await upload(['fake-image-renamed.csv', 'malformed-unclosed-quote.csv']);
check((await page.locator('#upload-errors p').count()) === 2, 'renamed image and malformed CSV rejected with messages');
// Unrecognized headers → mapping screen
await upload(['unmapped-headers.csv']);
check(await page.locator('#map-title').isVisible(), 'column-mapping screen shown for unknown headers');
await page.selectOption('#map-date', '0');
await page.selectOption('#map-description', '1');
await page.selectOption('#map-amount', '2');
await page.click('text=Import with these columns');
await page.waitForTimeout(200);
// PDF statement → review screen
await upload(['card-statement-text.pdf']);
await page.waitForSelector('#pdf-title', { timeout: 15000 });
const pdfRows = await page.locator('#pdf-review-panel tbody tr').count();
check(pdfRows === 7, `PDF statement parsed into ${pdfRows} reviewable rows (expected 7)`);
await page.click('#pdf-review-panel >> text=/Import \\d+ selected rows/');
await page.waitForTimeout(200);
// PDF paystub → confirmation form
await upload(['paystub-text.pdf']);
await page.waitForSelector('#stub-net', { timeout: 15000 });
check(await page.inputValue('#stub-net') === '2289.00', 'paystub net pay pre-filled for confirmation');
await page.click('#paystub-panel >> text=Save paycheck');
await page.waitForTimeout(200);

// 2. Review
await page.click('[data-step="review"]');
const txRows = await page.locator('#review-panel tbody tr').count();
check(txRows > 50, `review table shows transactions (${txRows} on page 1)`);
const scriptText = await page.locator('#review-panel th.desc', { hasText: '<script>alert(1)</script>' }).count();
check(scriptText === 1, 'hostile <script> description rendered as visible text');
// Re-categorize one transaction (creates a rule)
const firstSelect = page.locator('#review-panel select[id^="cat-"]').first();
await firstSelect.selectOption('Entertainment');
await page.waitForTimeout(200);
check((await page.locator('.rule-list li').count()) >= 1, 'changing a category created a user rule');

// 3. Insights
await page.click('[data-step="insights"]');
check(await page.locator('#insights-panel svg.chart').count() >= 3, 'insights charts rendered as inline SVG');
check(await page.locator('#insights-panel .flags li').count() >= 1, 'overspending flags shown');

// 4. Budget & debts
await page.click('[data-step="budget"]');
await page.click('#budget-503020');
await page.waitForTimeout(200);
check(await page.locator('table.budget tbody tr').count() > 3, '50/30/20 budget created');
const addSuggestion = page.locator('#debts-panel >> text=Add').first();
if (await addSuggestion.count()) { await addSuggestion.click(); await page.waitForTimeout(100); }
await page.fill('#debt-new-name', 'Car loan');
await page.fill('#debt-new-bal', '12000');
await page.fill('#debt-new-apr', '6.5');
await page.fill('#debt-new-min', '300');
await page.click('#debts-panel >> text=Add debt');
await page.waitForTimeout(200);
check(await page.locator('#debts-panel >> text=Avalanche').count() >= 1, 'avalanche vs snowball comparison shown');

// 5. Goals
await page.click('[data-step="goals"]');
await page.fill('#goal-name', 'Emergency fund');
await page.fill('#goal-target', '5000');
await page.fill('#goal-date', '2030-01-01');
await page.click('#goals-panel >> text=Add goal');
await page.waitForTimeout(200);
check(await page.locator('#goals-panel table tbody tr').count() === 1, 'goal planned');

// 6. Export
await page.click('[data-step="export"]');
check(await page.locator('#report .report-section').count() >= 6, 'report preview built');
const reportText = await page.locator('#report').innerText();
check(!/4111000011119876|9900005555/.test(reportText), 'account numbers masked in report by default');
await page.emulateMedia({ media: 'print' });
if (OUT) await page.pdf({ path: join(OUT, 'report-sample.pdf'), format: 'Letter', printBackground: true });
await page.emulateMedia({ media: 'screen' });
if (OUT) {
  await page.click('[data-step="insights"]');
  await page.screenshot({ path: join(OUT, 'insights.png'), fullPage: true });
}

// Network & storage audit
const after = requests.filter((r) => r.afterLoad);
check(after.length === 0, `no network requests after initial load (saw ${after.length}${after.length ? ': ' + after.map((r) => r.url).join(', ') : ''})`);
const storage = await page.evaluate(async () => ({
  local: localStorage.length,
  session: sessionStorage.length,
  cookie: document.cookie,
  idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
  caches: 'caches' in window ? (await caches.keys()).length : 0,
  sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  csp: window.__cspViolations,
}));
check(storage.local === 0 && storage.session === 0, 'localStorage and sessionStorage are empty');
check(storage.cookie === '', 'no cookies');
check(storage.idb === 0, 'no IndexedDB databases');
check(storage.caches === 0 && storage.sw === 0, 'no Cache API entries and no service workers');
check(storage.csp.length === 0, `no CSP violations${storage.csp.length ? ': ' + storage.csp.join('; ') : ''}`);
check(dialogs.every((d) => !d.startsWith('alert')), `no alert() executed from hostile text${dialogs.length ? ' (dialogs: ' + dialogs.join(' | ') + ')' : ''}`);
const errorsBeforeProbe = errors.length;
const ttBlocked = await page.evaluate(() => { try { document.body.insertAdjacentHTML('beforeend', '<b>x</b>'); return false; } catch { return true; } });
check(ttBlocked, 'Trusted Types CSP blocks HTML string sinks (insertAdjacentHTML throws)');
// The probe above logs one expected "requires 'TrustedHTML'" error; ignore only that one.
const realErrors = errors.slice(0, errorsBeforeProbe).concat(errors.slice(errorsBeforeProbe).filter((e) => !/TrustedHTML/.test(e)));
check(realErrors.length === 0, `no JS errors or warnings${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`);

// Clear all data
await page.click('#clear-all');
await page.waitForTimeout(200);
await page.click('[data-step="review"]');
check(await page.locator('#review-panel >> text=No transactions yet').count() === 1, '"Clear all data" wiped transactions');
await page.click('[data-step="upload"]');
check(await page.locator('#files-panel tbody tr').count() === 0, '"Clear all data" wiped files');

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll privacy checks passed.');
process.exit(failures.length ? 1 : 0);
