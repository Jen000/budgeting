// Pure helpers: money in integer cents, dates as 'YYYY-MM-DD' strings, merchant keys.
// No DOM access here so these can be unit-tested in Node.

export const LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxRowsPerFile: 50000,
  maxTotalTransactions: 200000,
  maxFiles: 50,
  maxColumns: 60,
  maxCellChars: 500,
  maxPdfPages: 150,
  pdfTimeoutMs: 60000,
  maxRules: 2000,
});

// ---------- money ----------

/**
 * Parse a money string into integer cents. Returns null when it isn't a number.
 * Handles: "$1,234.56", "-12.34", "(12.34)", "12.34-", "12.34 CR", "1.234,56", "€ 5,00".
 */
export function parseAmount(raw, { decimalComma = false } = {}) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.length > 40) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  const crdr = s.match(/\s*(CR|DR)\.?$/i);
  if (crdr) {
    if (crdr[1].toUpperCase() === 'DR') negative = !negative;
    s = s.slice(0, crdr.index);
  }
  if (/-$/.test(s)) { negative = !negative; s = s.slice(0, -1); }
  if (/^[-−]/.test(s.replace(/^[^\d\-−+]*/, ''))) { negative = !negative; }
  s = s.replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return null;
  let useComma = decimalComma;
  if (!decimalComma && /^\d{1,3}(\.\d{3})+,\d{1,2}$|^\d+,\d{2}$/.test(s)) useComma = true;
  if (useComma) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if ((s.match(/\./g) || []).length > 1) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n > 1e11) return null;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

export function formatMoney(cents, { sign = false, whole = false } = {}) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  if (neg) return '−$' + body;
  return (sign && cents > 0 ? '+$' : '$') + body;
}

/** Parse a user-typed money input ("1,200" / "1200.50") into cents; null if blank/invalid. */
export function parseMoneyInput(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const c = parseAmount(s);
  return c === null ? null : c;
}

export function centsToInput(cents) {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

// ---------- dates ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) { return String(n).padStart(2, '0'); }

export function isValidYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function makeISO(y, m, d) {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  return isValidYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * Parse a date string. order: 'MDY' | 'DMY' (only matters for numeric a/b/year forms).
 * Returns 'YYYY-MM-DD' or null. defaultYear is used for forms with no year ("01/15", "Jan 15").
 */
export function parseDate(raw, order = 'MDY', defaultYear = null) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s || s.length > 40) return null;
  let m;
  // ISO / YYYY-MM-DD / YYYY/MM/DD, optional time
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) return makeISO(+m[1], +m[2], +m[3]);
  // YYYYMMDD (OFX style, optional time/tz)
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{0,6}(?:\.\d+)?)?(?:\[.*\])?$/))) return makeISO(+m[1], +m[2], +m[3]);
  // a/b/yyyy or a-b-yy
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    return order === 'DMY' ? makeISO(y, b, a) : makeISO(y, a, b);
  }
  // a/b (no year)
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})$/)) && defaultYear) {
    const a = +m[1], b = +m[2];
    return order === 'DMY' ? makeISO(defaultYear, b, a) : makeISO(defaultYear, a, b);
  }
  // 15-Jan-2024, 15 Jan 2024, 15 January 24
  if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ,]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? makeISO(+m[3], mon, +m[1]) : null;
  }
  // Jan 15, 2024 / January 15 2024 / Jan 15
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:,? (\d{2}|\d{4}))?$/))) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = m[3] ? +m[3] : defaultYear;
    return mon && y ? makeISO(y, mon, +m[2]) : null;
  }
  return null;
}

/** Look at many date strings and guess whether day or month comes first. */
export function guessDateOrder(samples) {
  let mdy = 0, dmy = 0;
  for (const raw of samples) {
    const m = String(raw ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
    if (!m) continue;
    if (+m[1] > 12 && +m[2] <= 12) dmy++;
    if (+m[2] > 12 && +m[1] <= 12) mdy++;
  }
  return dmy > mdy ? 'DMY' : 'MDY';
}

export function monthKey(iso) { return iso.slice(0, 7); }

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole months between two ISO dates, counting partial months as a fraction (min 0). */
export function monthsSpan(fromISO, toISO) {
  const days = daysBetween(fromISO, toISO) + 1;
  return Math.max(days / 30.4375, 0);
}

// ---------- text ----------

/** Make arbitrary file text safe-ish for display: strip control chars, cap length. */
export function cleanText(raw, max = LIMITS.maxCellChars) {
  let s = String(raw ?? '');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

const MERCHANT_NOISE = [
  /^(pos|debit|credit|card|purchase|recurring|preauthorized|ach|checkcard|check card|visa|mc|dbt|pos purchase|debit card purchase|point of sale)\b[\s:-]*/i,
  /^(sq|tst|sp|pp|paypal|py|in|dd|fs|wpy)\s?\*\s*/i,
];

/**
 * Normalize a raw description into a short merchant key used for grouping,
 * duplicate detection and subscription detection.
 */
export function merchantKey(desc) {
  let s = String(desc ?? '').toUpperCase();
  for (let i = 0; i < 3; i++) for (const re of MERCHANT_NOISE) s = s.replace(re, '');
  s = s
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ') // embedded dates
    .replace(/#\s*\d+/g, ' ') // store numbers
    .replace(/\b[X*]{2,}\d{2,}\b/g, ' ') // masked card numbers
    .replace(/\d{3,}/g, ' ') // long digit runs (ids, phone numbers)
    .replace(/\b(WWW\.)|\.(COM|NET|ORG|CO|IO)\b/g, ' ')
    .replace(/[^A-Z0-9&' ]+/g, ' ')
    .replace(/\s+[A-Z]{2}\s*$/, '') // trailing state code
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean).slice(0, 3);
  return words.join(' ').replace(/[^A-Z0-9]+$/, '') || 'UNKNOWN';
}

/** Title-case a merchant key for display. */
export function merchantLabel(key) {
  return key.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/** Mask long digit runs, keeping the last 4 (account and card numbers). */
export function maskDigits(text) {
  return String(text ?? '').replace(/\d[\d -]{4,}\d/g, (run) => {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 5) return run;
    return '••••' + digits.slice(-4);
  });
}

export function maskAccount(acct) {
  const s = String(acct ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^0-9A-Za-z]/g, '');
  return digits.length <= 4 ? '••••' + digits : '••••' + digits.slice(-4);
}

let idCounter = 0;
export function newId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) t += fn(x);
  return t;
}
