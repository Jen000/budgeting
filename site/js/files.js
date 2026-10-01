// File intake: limits, content sniffing (magic bytes, not extensions) and routing to parsers.
import { LIMITS, newId, cleanText, maskAccount } from './util.js';
import { ImportError, readCsv, tableToDrafts } from './parsers/csv.js';
import { looksLikeOfx, parseOfx } from './parsers/ofx.js';
import { isPdfAvailable, extractPdfLines, parseStatementLines, parsePaystubLines } from './parsers/pdf-import.js';
import { addDrafts, reconcile } from './ledger.js';

export { ImportError, isPdfAvailable };

function startsWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

/** Decide what a file really is from its bytes. */
export function sniff(bytes) {
  if (!bytes.length) return { kind: 'empty' };
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return { kind: 'pdf' };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { kind: 'zip' };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { kind: 'xls' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, [0x47, 0x49, 0x46])) return { kind: 'image' };
  let encoding = 'utf-8';
  if (startsWith(bytes, [0xff, 0xfe])) encoding = 'utf-16le';
  else if (startsWith(bytes, [0xfe, 0xff])) encoding = 'utf-16be';
  else {
    const probe = bytes.subarray(0, 8192);
    for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return { kind: 'binary' };
  }
  let text = new TextDecoder(encoding).decode(bytes);
  const bad = (text.slice(0, 20000).match(/�/g) || []).length;
  if (encoding === 'utf-8' && bad > 3) text = new TextDecoder('windows-1252').decode(bytes);
  text = text.replace(/^﻿/, '');
  if (looksLikeOfx(text)) return { kind: 'ofx', text };
  if (/^\s*<(!doctype html|html|\?xml|svg)/i.test(text)) return { kind: 'markup' };
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (lines.length >= 2 && lines.filter((l) => /[,;\t|]/.test(l)).length >= 2) return { kind: 'csv', text };
  return { kind: 'unknown' };
}

const REJECTIONS = {
  empty: 'This file is empty.',
  zip: 'This looks like an Excel (.xlsx) or other zipped file. Open it and save/export it as CSV, then upload the CSV.',
  xls: 'This looks like an old Excel (.xls) file. Save it as CSV, then upload the CSV.',
  image: 'This is an image. Scanned documents are not supported (no OCR). Download a CSV, OFX or text-based PDF from your bank.',
  binary: 'This file is not a text, OFX or PDF file.',
  markup: 'This looks like a web page or XML document, not a statement export.',
  unknown: 'This file\'s content was not recognized as CSV, OFX/QFX or PDF.',
};

/**
 * Import one File. Mutates state and returns { message, needs } where needs is
 * null | 'mapping' | 'pdf-review' | 'paystub-review'.
 */
export async function importFile(state, file) {
  const name = cleanText(file.name, 120) || 'file';
  if (state.files.length >= LIMITS.maxFiles) throw new ImportError(`You can load up to ${LIMITS.maxFiles} files at once.`);
  if (file.size > LIMITS.maxFileBytes) throw new ImportError(`${name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxFileBytes / 1048576} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const s = sniff(bytes);
  if (REJECTIONS[s.kind]) throw new ImportError(`${name}: ${REJECTIONS[s.kind]}`);

  if (s.kind === 'csv') {
    const table = readCsv(s.text);
    const record = { id: newId('f'), name, format: 'CSV', accountLabel: '', isCreditCard: false, table, count: 0, skipped: [] };
    if (!table.mappingRecognized) {
      state.pendingCsv = { record };
      return { message: `${name}: choose which columns to use.`, needs: 'mapping' };
    }
    return { message: applyCsv(state, record), needs: null };
  }

  if (s.kind === 'ofx') {
    const { accounts } = parseOfx(s.text);
    const parts = [];
    for (const acct of accounts) {
      const record = {
        id: newId('f'), name, format: 'OFX', accountLabel: acct.accountId, isCreditCard: acct.isCreditCard,
        count: 0, skipped: acct.skipped ? [{ row: '—', reason: `${acct.skipped} unreadable entries` }] : [],
      };
      state.files.push(record);
      record.count = addDrafts(state, record, acct.drafts);
      parts.push(`${record.count} transactions from ${acct.isCreditCard ? 'card' : 'account'} ${maskAccount(acct.accountId) || '(unnamed)'}`);
      if (acct.isCreditCard && acct.balance !== null && acct.balance < 0) {
        state.debtSuggestions.push({ id: newId('s'), name: `Credit card ${maskAccount(acct.accountId)}`, balance: -acct.balance, apr: null, minPayment: null, source: name });
      }
    }
    reconcile(state);
    return { message: `${name}: imported ${parts.join('; ')}.`, needs: null };
  }

  // PDF
  if (!isPdfAvailable()) throw new ImportError(`${name}: PDF support is not available. Use a CSV or OFX export instead.`);
  const { lines } = await extractPdfLines(bytes);
  if (lines.length < 3) throw new ImportError(`${name}: no text was found. Scanned/image PDFs are not supported (no OCR).`);
  const joined = lines.join(' ');
  if (/\b(net pay|gross pay)\b/i.test(joined) && !/\b(statement period|closing date|new balance)\b/i.test(joined)) {
    const stub = parsePaystubLines(lines);
    if (!stub) throw new ImportError(`${name}: this looks like a paystub, but no gross or net pay could be read. Enter it manually below.`);
    state.pendingPaystub = { ...stub, source: name };
    return { message: `${name}: paystub numbers found. Please confirm them below.`, needs: 'paystub-review' };
  }
  const parsed = parseStatementLines(lines);
  if (!parsed.rows.length) throw new ImportError(`${name}: no transaction lines could be recognized in this PDF. A CSV or OFX export from your bank will work better.`);
  state.pendingPdf = {
    record: { id: newId('f'), name, format: 'PDF', accountLabel: parsed.accountHint, isCreditCard: parsed.isCard, count: 0, skipped: [] },
    rows: parsed.rows.map((r) => ({ ...r, id: newId('p') })),
    debtHint: parsed.debtHint,
  };
  return { message: `${name}: ${parsed.rows.length} possible transactions found. Please review them.`, needs: 'pdf-review' };
}

/** Convert a CSV table with its current options into transactions (used on first import and re-map). */
export function applyCsv(state, record, options = {}) {
  record.options = { ...(record.options || {}), ...options };
  const { drafts, skipped, resolvedSign } = tableToDrafts(record.table, record.options);
  if (!drafts.length) throw new ImportError(`${record.name}: no rows could be read with this column mapping (${skipped.length} skipped).`);
  record.options.signConvention = resolvedSign;
  record.skipped = skipped;
  if (!state.files.includes(record)) state.files.push(record);
  state.transactions = state.transactions.filter((t) => t.fileId !== record.id);
  record.count = addDrafts(state, record, drafts);
  // A CSV where money out is positive is usually a credit card.
  record.isCreditCard = record.isCreditCard || resolvedSign === 'posOut';
  reconcile(state);
  return `${record.name}: imported ${record.count} transactions${skipped.length ? `, skipped ${skipped.length} unreadable rows` : ''}.`;
}

export function confirmPdf(state) {
  const p = state.pendingPdf;
  if (!p) return '';
  const drafts = p.rows.filter((r) => r.include && r.date && r.amount).map((r) => ({ date: r.date, description: r.description, amount: r.amount, account: p.record.accountLabel }));
  if (!drafts.length) throw new ImportError('No rows are selected for import.');
  state.files.push(p.record);
  p.record.count = addDrafts(state, p.record, drafts);
  if (p.debtHint) state.debtSuggestions.push({ id: newId('s'), name: `${p.record.isCreditCard ? 'Card' : 'Loan'} ${maskAccount(p.record.accountLabel)}`.trim(), ...p.debtHint, source: p.record.name });
  state.pendingPdf = null;
  reconcile(state);
  return `${p.record.name}: imported ${p.record.count} reviewed transactions.`;
}

export function removeFile(state, fileId) {
  state.files = state.files.filter((f) => f.id !== fileId);
  state.transactions = state.transactions.filter((t) => t.fileId !== fileId);
  reconcile(state);
}
