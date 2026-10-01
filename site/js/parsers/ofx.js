// OFX 1.x (SGML, unclosed tags), OFX 2.x (XML) and QFX (Intuit's OFX) reader.
// Uses a linear scan with simple regexes; never uses DOMParser or eval.
import { LIMITS, cleanText, parseAmount, parseDate } from '../util.js';
import { ImportError } from './csv.js';

export function looksLikeOfx(text) {
  const head = text.slice(0, 4096);
  return /OFXHEADER\s*:/i.test(head) || /<OFX>/i.test(text.slice(0, 20000));
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_, n) => { const c = Number(n); return c > 31 && c < 0x10FFFF ? String.fromCodePoint(c) : ''; })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => { const c = parseInt(n, 16); return c > 31 && c < 0x10FFFF ? String.fromCodePoint(c) : ''; })
    .replace(/&amp;/gi, '&');
}

/** Read every leaf value <TAG>value inside a block (works for SGML and XML). */
function leafValues(block) {
  const out = {};
  const re = /<([A-Za-z0-9.]+)>([^<\r\n]*)/g;
  let m;
  while ((m = re.exec(block))) {
    const tag = m[1].toUpperCase();
    const val = m[2].trim();
    if (val && out[tag] === undefined) out[tag] = decodeEntities(val);
  }
  return out;
}

/** Split text into blocks starting at <TAG> and ending at </TAG> or the next <TAG> / closing parent. */
function blocks(text, tag, stopTags = []) {
  const res = [];
  const upper = text.toUpperCase();
  const openTag = `<${tag}>`;
  const enders = [`</${tag}>`, openTag, ...stopTags.map((t) => `</${t}>`)];
  // Cache the next position of each terminator so the scan stays linear even when a
  // terminator never appears (SGML OFX omits most closing tags).
  const next = enders.map(() => -2);
  let pos = upper.indexOf(openTag);
  while (pos !== -1) {
    const start = pos + openTag.length;
    let end = text.length;
    enders.forEach((e, k) => {
      if (next[k] === -2 || (next[k] !== -1 && next[k] < start)) next[k] = upper.indexOf(e, start);
      if (next[k] !== -1 && next[k] < end) end = next[k];
    });
    res.push(text.slice(start, end));
    if (res.length > LIMITS.maxRowsPerFile) throw new ImportError(`This file has more than ${LIMITS.maxRowsPerFile.toLocaleString()} transactions.`);
    pos = upper.indexOf(openTag, start);
  }
  return res;
}

/**
 * Parse OFX/QFX text. Returns { accounts: [{ accountId, accountType, isCreditCard, balance, drafts }] }.
 * OFX amounts are signed from the account holder's point of view (negative = money out) for
 * both bank and credit-card statements, so no sign guessing is needed.
 */
export function parseOfx(text) {
  if (!looksLikeOfx(text)) throw new ImportError('This does not look like an OFX/QFX file.');
  const ofxStart = text.search(/<OFX>/i);
  const body = text.slice(ofxStart);

  const statements = [
    ...blocks(body, 'STMTRS', []).map((b) => ({ b, cc: false })),
    ...blocks(body, 'CCSTMTRS', []).map((b) => ({ b, cc: true })),
  ];
  if (!statements.length) throw new ImportError('No bank or credit-card statement was found in this OFX file. (Investment and loan OFX files are not supported.)');

  const accounts = [];
  for (const { b, cc } of statements) {
    const acctBlock = blocks(b, cc ? 'CCACCTFROM' : 'BANKACCTFROM', [])[0] || '';
    const acct = leafValues(acctBlock);
    const ledger = leafValues(blocks(b, 'LEDGERBAL', [])[0] || '');
    const drafts = [];
    let skipped = 0;
    for (const t of blocks(b, 'STMTTRN', ['BANKTRANLIST'])) {
      const v = leafValues(t);
      const date = parseDate(v.DTPOSTED || v.DTUSER || '');
      const amount = parseAmount(v.TRNAMT);
      if (!date || amount === null || amount === 0) { skipped++; continue; }
      const name = cleanText(v.NAME || v.PAYEE || '');
      const memo = cleanText(v.MEMO || '');
      let description = name || memo || cleanText(v.TRNTYPE || '') || '(no description)';
      if (name && memo && !name.includes(memo) && memo.length < 80 && /^(.{0,32})$/.test(name)) description = `${name} ${memo}`.trim();
      drafts.push({
        date,
        description: cleanText(description),
        amount,
        fitid: cleanText(v.FITID || '', 80),
        account: cleanText(acct.ACCTID || '', 40),
      });
    }
    accounts.push({
      accountId: cleanText(acct.ACCTID || '', 40),
      accountType: cc ? 'CREDITCARD' : cleanText(acct.ACCTTYPE || 'BANK', 20),
      isCreditCard: cc,
      balance: parseAmount(ledger.BALAMT),
      balanceDate: parseDate(ledger.DTASOF || ''),
      drafts,
      skipped,
    });
  }
  return { accounts };
}
