// Small, strict CSV reader for bank/credit-card exports. No dependencies, no eval.
import { LIMITS, cleanText, parseAmount, parseDate, guessDateOrder } from '../util.js';

export class ImportError extends Error {}

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const multi = counts.filter((c) => c > 1);
    if (!multi.length) continue;
    const mode = multi.sort((a, b) => multi.filter((x) => x === b).length - multi.filter((x) => x === a).length)[0];
    const score = multi.filter((c) => c === mode).length * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitLine(line, d) {
  return tokenize(line, d, 1)[0] || [];
}

/**
 * RFC 4180 tokenizer. Handles quoted fields, escaped quotes, CRLF and newlines in quotes.
 * Throws ImportError when the row limit is exceeded. Single linear pass, so it cannot hang.
 */
export function tokenize(text, delimiter = ',', maxRows = LIMITS.maxRowsPerFile + 50) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushField = () => {
    if (row.length < LIMITS.maxColumns) row.push(field.length > LIMITS.maxCellChars * 4 ? field.slice(0, LIMITS.maxCellChars * 4) : field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new ImportError(`This file has more than ${LIMITS.maxRowsPerFile.toLocaleString()} rows. Split it into smaller date ranges and upload them separately.`);
  };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { field = ''; inQuotes = true; i++; continue; }
    if (c === delimiter) { pushField(); i++; continue; }
    if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'trans date', 'trans. date', 'posted date', 'posting date', 'post date', 'value date', 'booking date', 'date posted', 'effective date'],
  description: ['description', 'payee', 'merchant', 'name', 'details', 'transaction description', 'memo', 'narrative', 'transaction details', 'reference', 'original description', 'merchant name'],
  amount: ['amount', 'transaction amount', 'amount (usd)', 'amt', 'value', 'net amount', 'amount usd'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'debit amount', 'paid out', 'outflow', 'charges', 'withdrawal amount'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'credit amount', 'paid in', 'inflow', 'payments', 'deposit amount'],
  type: ['type', 'transaction type', 'trans type', 'debit/credit', 'cr/dr', 'dr/cr', 'details type'],
  account: ['account', 'account number', 'account name', 'card', 'card no.', 'card number', 'card member'],
  category: ['category', 'bank category'],
};

function norm(h) { return String(h ?? '').toLowerCase().replace(/[^a-z0-9/(). ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Try to map header names to roles. Returns { date, description, amount, debit, credit, type, account } as column indexes. */
export function mapHeaders(headers) {
  const map = {};
  const normalized = headers.map(norm);
  for (const role of Object.keys(HEADER_ALIASES)) {
    // exact match first, then "contains" match
    let idx = normalized.findIndex((h, i) => HEADER_ALIASES[role].includes(h) && !Object.values(map).includes(i));
    if (idx === -1 && role !== 'type' && role !== 'account') {
      idx = normalized.findIndex((h, i) => h && HEADER_ALIASES[role].some((a) => h.includes(a)) && !Object.values(map).includes(i));
    }
    if (idx !== -1) map[role] = idx;
  }
  // "memo" is only a description if there's nothing better
  if (map.description !== undefined && normalized[map.description] === 'memo') {
    const better = normalized.findIndex((h) => ['payee', 'name', 'merchant'].includes(h));
    if (better !== -1) map.description = better;
  }
  return map;
}

export function isMappingUsable(map) {
  return map.date !== undefined && map.description !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined);
}

/** Find the header row among the first rows (banks often add preamble lines). */
export function findHeaderRow(rows) {
  let best = { index: 0, score: -1 };
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const map = mapHeaders(rows[i]);
    const score = Object.keys(map).length + (isMappingUsable(map) ? 10 : 0);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

/**
 * Read a CSV text into a "raw table" the UI can confirm or re-map.
 */
export function readCsv(text) {
  if (!text.trim()) throw new ImportError('This file is empty.');
  const delimiter = detectDelimiter(text);
  const rows = tokenize(text, delimiter);
  if (rows.length < 2) throw new ImportError('This file has no data rows. Check that it is a transactions export.');
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map((h, i) => cleanText(h, 60) || `Column ${i + 1}`);
  const body = rows.slice(headerIndex + 1).filter((r) => r.some((c) => c.trim() !== ''));
  if (!body.length) throw new ImportError('No transaction rows were found under the header row.');
  if (body.length > LIMITS.maxRowsPerFile) throw new ImportError(`This file has more than ${LIMITS.maxRowsPerFile.toLocaleString()} rows.`);
  const map = mapHeaders(headers);
  const decimalComma = delimiter === ';' && body.slice(0, 30).some((r) => r.some((c) => /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(c.trim())));
  const dateSamples = map.date !== undefined ? body.slice(0, 200).map((r) => r[map.date]) : [];
  return {
    headers,
    rows: body,
    map,
    mappingRecognized: isMappingUsable(map),
    dateOrder: guessDateOrder(dateSamples),
    decimalComma,
    signConvention: 'auto',
  };
}

const TYPE_DEBIT = /^(debit|dr|d|withdrawal|purchase|sale|payment out|fee|charge)$/i;
const TYPE_CREDIT = /^(credit|cr|c|deposit|refund|return|payment)$/i;

/**
 * Turn a confirmed raw table into transaction drafts.
 * signConvention: 'negOut' (negative = money out), 'posOut' (positive = money out), 'auto'.
 * Returns { drafts, skipped, resolvedSign } where drafts use cents (negative = money out).
 */
export function tableToDrafts(table, options = {}) {
  const map = options.map || table.map;
  const dateOrder = options.dateOrder || table.dateOrder;
  const decimalComma = options.decimalComma ?? table.decimalComma;
  let sign = options.signConvention || table.signConvention || 'auto';
  if (!isMappingUsable(map)) throw new ImportError('Choose which columns hold the date, the description and the amount.');

  const drafts = [];
  const skipped = [];
  table.rows.forEach((r, i) => {
    const rowNo = i + 1;
    const date = parseDate(r[map.date], dateOrder);
    if (!date) { skipped.push({ row: rowNo, reason: 'unreadable date' }); return; }
    let amount = null;
    let fromSplitColumns = false;
    if (map.debit !== undefined || map.credit !== undefined) {
      const debit = map.debit !== undefined ? parseAmount(r[map.debit], { decimalComma }) : null;
      const credit = map.credit !== undefined ? parseAmount(r[map.credit], { decimalComma }) : null;
      if (debit !== null && debit !== 0) { amount = -Math.abs(debit); fromSplitColumns = true; }
      else if (credit !== null && credit !== 0) { amount = Math.abs(credit); fromSplitColumns = true; }
      else if (debit === 0 || credit === 0) { amount = 0; fromSplitColumns = true; }
    }
    if (amount === null && map.amount !== undefined) {
      amount = parseAmount(r[map.amount], { decimalComma });
      if (amount !== null && map.type !== undefined) {
        const t = String(r[map.type] ?? '').trim();
        if (TYPE_DEBIT.test(t)) { amount = -Math.abs(amount); fromSplitColumns = true; }
        else if (TYPE_CREDIT.test(t)) { amount = Math.abs(amount); fromSplitColumns = true; }
      }
    }
    if (amount === null) { skipped.push({ row: rowNo, reason: 'unreadable amount' }); return; }
    if (amount === 0) { skipped.push({ row: rowNo, reason: 'zero amount' }); return; }
    const description = cleanText(r[map.description]) || '(no description)';
    drafts.push({
      date,
      description,
      amount,
      signFixed: fromSplitColumns,
      account: map.account !== undefined ? cleanText(r[map.account], 60) : '',
    });
  });

  if (sign === 'auto') sign = guessSignConvention(drafts);
  if (sign === 'posOut') for (const d of drafts) if (!d.signFixed) d.amount = -d.amount;
  for (const d of drafts) delete d.signFixed;
  return { drafts, skipped, resolvedSign: sign };
}

/**
 * Credit-card exports often show purchases as positive numbers.
 * If most rows are positive and payment-like rows are negative, assume positive = money out.
 */
export function guessSignConvention(drafts) {
  const free = drafts.filter((d) => !d.signFixed);
  if (free.length < 3) return 'negOut';
  const positives = free.filter((d) => d.amount > 0).length;
  const paymentRows = free.filter((d) => /\b(payment|thank you|autopay|refund|credit)\b/i.test(d.description));
  const paymentsNegative = paymentRows.length > 0 && paymentRows.filter((d) => d.amount < 0).length / paymentRows.length > 0.6;
  const share = positives / free.length;
  if (paymentRows.length && paymentsNegative && share > 0.5) return 'posOut';
  if (!paymentRows.length && share > 0.8) return 'posOut';
  return 'negOut';
}
