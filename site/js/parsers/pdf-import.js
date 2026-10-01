// ─────────────────────────────────────────────────────────────────────────────
// The ONLY module that talks to PDF.js. To remove PDF support entirely:
//   1. delete site/vendor/pdfjs-*/ and the two vendor <script> tags in index.html
//   2. delete this file and its import in js/files.js (isPdfAvailable() then
//      returns false and PDFs are rejected with a clear message)
//
// PDF.js is loaded by index.html via <script type="module" integrity=...>.
// pdf.worker.mjs registers globalThis.pdfjsWorker, so the parser runs in-page
// ("fake worker") and nothing is fetched after page load. We only call
// getTextContent(): no rendering, no annotations, no scripts, no forms, no fonts.
// ─────────────────────────────────────────────────────────────────────────────
import { LIMITS, cleanText, parseAmount, parseDate } from '../util.js';
import { ImportError } from './csv.js';
import { findDebtHints } from '../debt.js';

export const PDFJS_VERSION = '6.3.289';

export function isPdfAvailable() {
  const lib = globalThis.pdfjsLib;
  return !!(lib && typeof lib.getDocument === 'function' && globalThis.pdfjsWorker && lib.version === PDFJS_VERSION);
}

const SAFE_OPTIONS = Object.freeze({
  isEvalSupported: false,        // required by policy (6.x has no eval code paths; CSP also forbids eval)
  enableXfa: false,              // never interpret XFA forms
  disableFontFace: true,         // never install embedded fonts into the page
  useSystemFonts: false,
  fontExtraProperties: false,
  useWorkerFetch: false,         // never fetch cMaps / fonts / wasm
  useWasm: false,                // never load WebAssembly image decoders
  cMapUrl: null,
  standardFontDataUrl: null,
  wasmUrl: null,
  iccUrl: null,
  disableRange: true,
  disableStream: true,
  disableAutoFetch: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  enableHWA: false,
  pdfBug: false,
  verbosity: 0,                  // errors only
});

/** Extract text lines from a PDF. Returns { lines: string[], pageCount }. */
export async function extractPdfLines(bytes) {
  if (!isPdfAvailable()) throw new ImportError('PDF support is not available in this build. Use a CSV or OFX export instead.');
  const lib = globalThis.pdfjsLib;
  const task = lib.getDocument({ ...SAFE_OPTIONS, data: bytes });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ImportError('Reading this PDF took too long and was stopped. Try a CSV or OFX export instead.')), LIMITS.pdfTimeoutMs);
  });
  try {
    return await Promise.race([readAll(task), timeout]);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    if (err && err.name === 'PasswordException') throw new ImportError('This PDF is password-protected. Remove the password in your PDF viewer, or use a CSV/OFX export.');
    if (err && err.name === 'InvalidPDFException') throw new ImportError('This PDF appears to be damaged or is not a real PDF.');
    throw new ImportError('This PDF could not be read. Try a CSV or OFX export instead.');
  } finally {
    clearTimeout(timer);
    try { await task.destroy(); } catch { /* ignore */ }
  }
}

async function readAll(task) {
  const doc = await task.promise;
  const pageCount = doc.numPages;
  if (pageCount > LIMITS.maxPdfPages) throw new ImportError(`This PDF has ${pageCount} pages; the limit is ${LIMITS.maxPdfPages}.`);
  const lines = [];
  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    lines.push(...groupIntoLines(content.items));
    page.cleanup();
    if (lines.length > LIMITS.maxRowsPerFile * 3) throw new ImportError('This PDF contains too much text to be a statement.');
  }
  return { lines, pageCount };
}

/** Group positioned text items into visual lines (same baseline), left to right. */
function groupIntoLines(items) {
  const rows = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim() || !Array.isArray(it.transform)) continue;
    const x = Number(it.transform[4]) || 0;
    const y = Number(it.transform[5]) || 0;
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => cleanText(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '), 400)).filter(Boolean);
}

const DATE_START = /^((?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)|(?:[A-Z][a-z]{2}\.? \d{1,2}(?:,? \d{4})?))\s+/;
const AMOUNT = /(?:\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR|-))?)/g;

/** Find the statement year(s) so "01/15" lines get a year. */
function statementYear(lines) {
  // Prefer the closing date of a period ("12/01/2023 through 01/05/2024" -> 2024).
  for (const l of lines.slice(0, 80)) {
    const p = l.match(/\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\s*(?:-|–|to|through|thru)\s*\d{1,2}[/-]\d{1,2}[/-](\d{4}|\d{2})\b/i);
    if (p) { const y = Number(p[1]); return y < 100 ? 2000 + y : y; }
  }
  for (const l of lines.slice(0, 80)) {
    const m = l.match(/(?:statement|closing|period|through|ending)[^0-9]{0,30}(?:\d{1,2}[/-]\d{1,2}[/-](\d{4}|\d{2})|[A-Z][a-z]+ \d{1,2},? (\d{4}))/i);
    if (m) { const y = Number(m[1] || m[2]); return y < 100 ? 2000 + y : y; }
  }
  const any = lines.join(' ').match(/\b(20\d{2})\b/);
  return any ? Number(any[1]) : new Date().getFullYear();
}

/**
 * Heuristic statement parser. Everything it returns goes to a review screen before import.
 * Returns { rows: [{ date, description, amount, include }], debtHint, accountHint }.
 */
export function parseStatementLines(lines) {
  const year = statementYear(lines);
  const joined = lines.join('\n');
  const isCard = /credit card|card ?member|minimum payment|credit limit|purchases/i.test(joined);
  let section = isCard ? 'out' : null; // 'in' | 'out' | null
  const rows = [];
  for (const line of lines) {
    if (/^(deposits|credits|payments and (other )?credits|payments, credits|additions|money in)\b/i.test(line)) { section = 'in'; continue; }
    if (/^(withdrawals|debits|purchases|checks paid|fees|subtractions|money out|electronic withdrawals|card purchases|other withdrawals)\b/i.test(line)) { section = 'out'; continue; }
    const dm = line.match(DATE_START);
    if (!dm) continue;
    let rest = line.slice(dm[0].length);
    const second = rest.match(DATE_START); // posting date after transaction date
    if (second) rest = rest.slice(second[0].length);
    const amounts = rest.match(AMOUNT);
    if (!amounts) continue;
    const firstAmt = rest.search(AMOUNT);
    const description = cleanText(rest.slice(0, firstAmt), 200);
    if (!description || /^(beginning|ending|previous|new) balance/i.test(description)) continue;
    const date = parseDate(dm[1].replace(/\.$/, ''), 'MDY', year);
    if (!date) continue;
    let amount = parseAmount(amounts[0]);
    if (amount === null || amount === 0) continue;
    const explicitSign = /^\(|^-|-$|CR$|DR$/.test(amounts[0].trim());
    if (!explicitSign) {
      if (section === 'in') amount = Math.abs(amount);
      else if (section === 'out') amount = -Math.abs(amount);
      else amount = -Math.abs(amount);
      if (isCard && /payment|thank you|credit|refund|return/i.test(description) && section !== 'out') amount = Math.abs(amount);
    } else if (isCard && /CR$/.test(amounts[0].trim())) {
      amount = Math.abs(amount);
    }
    rows.push({ date, description, amount, include: true });
    if (rows.length > LIMITS.maxRowsPerFile) break;
  }
  // A Dec→Jan statement: lines without a year got the closing year; move Nov/Dec back a year.
  const monthsSeen = new Set(rows.map((r) => r.date.slice(5, 7)));
  if (monthsSeen.has('01') && monthsSeen.has('12')) {
    for (const r of rows) {
      if ((r.date.slice(5, 7) === '12' || r.date.slice(5, 7) === '11') && Number(r.date.slice(0, 4)) === year) {
        r.date = `${year - 1}${r.date.slice(4)}`;
      }
    }
  }
  const acct = joined.match(/(?:account|card)\s*(?:number|no\.?|#|ending in)[:\s]*([X*\d][X*\d -]{3,24}\d)/i);
  const hint = isCard || /loan|mortgage/i.test(joined) ? findDebtHints(joined) : null;
  return { rows, debtHint: hint, accountHint: acct ? cleanText(acct[1], 30) : '', isCard };
}

/** Pull paystub numbers for the user to confirm. Never imported without confirmation. */
export function parsePaystubLines(lines) {
  const text = lines.join('\n');
  const money = (re) => {
    const m = text.match(re);
    if (!m) return null;
    const v = parseAmount(m[1]);
    return v === null ? null : Math.abs(v);
  };
  const AMT = '\\$?\\s?([\\d,]+\\.\\d{2})';
  const gross = money(new RegExp(`(?:gross pay|gross earnings|total gross|gross)[^\\d$\\n]{0,25}${AMT}`, 'i'));
  const net = money(new RegExp(`(?:net pay|net amount|take home|net check|net)[^\\d$\\n]{0,25}${AMT}`, 'i'));
  const deductions = [];
  const DED = [
    ['Federal income tax', /(?:federal (?:income )?(?:tax|withholding)|fed(?:eral)? w\/?h|fitw)/i],
    ['Social Security', /(?:social security|oasdi|fica[- ]ss)/i],
    ['Medicare', /(?:medicare|fica[- ]med)/i],
    ['State income tax', /(?:state (?:income )?tax|state w\/?h|sitw)/i],
    ['Retirement (401k/403b)', /(?:401\s?\(?k\)?|403\s?\(?b\)?|retirement)/i],
    ['Health insurance', /(?:medical|health|dental|vision)(?: ins(?:urance)?)?/i],
  ];
  for (const [name, re] of DED) {
    const line = lines.find((l) => re.test(l) && /\d+\.\d{2}/.test(l));
    if (!line) continue;
    const m = line.slice(line.search(re)).match(/([\d,]+\.\d{2})/);
    const v = m ? parseAmount(m[1]) : null;
    if (v) deductions.push({ name, amount: Math.abs(v) });
  }
  let frequency = 'biweekly';
  const period = text.match(/(?:pay period|period beginning|period start)[^\d]{0,20}(\d{1,2}\/\d{1,2}\/\d{2,4})[^\d]{1,20}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (period) {
    const a = parseDate(period[1]), b = parseDate(period[2]);
    if (a && b) {
      const days = (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
      frequency = days <= 8 ? 'weekly' : days <= 15 ? 'biweekly' : days <= 17 ? 'semimonthly' : 'monthly';
    }
  }
  if (!gross && !net) return null;
  return { gross, net, frequency, deductions };
}
