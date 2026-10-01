// Dev-only unit tests. Run with: node --test tests/
// Uses only Node's built-in test runner; nothing here ships to the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmount, parseDate, merchantKey, maskDigits, guessDateOrder, cleanText } from '../site/js/util.js';
import { readCsv, tableToDrafts, tokenize, ImportError } from '../site/js/parsers/csv.js';
import { parseOfx } from '../site/js/parsers/ofx.js';
import { parseStatementLines, parsePaystubLines } from '../site/js/parsers/pdf-import.js';
import { categorize, defaultRuleList } from '../site/js/categorize.js';
import { state, clearAll } from '../site/js/state.js';
import { importFile, sniff } from '../site/js/files.js';
import { isExcluded } from '../site/js/ledger.js';
import { analyze, overspendingFlags } from '../site/js/analysis.js';
import { simulate, compareStrategies } from '../site/js/debt.js';
import { suggestBudget, planGoals, monthsUntil } from '../site/js/budget.js';

const sample = (name) => new URL(`../samples/${name}`, import.meta.url);
const asFile = (name) => new File([readFileSync(sample(name))], name);

test('parseAmount handles common formats', () => {
  assert.equal(parseAmount('$1,234.56'), 123456);
  assert.equal(parseAmount('-12.34'), -1234);
  assert.equal(parseAmount('(12.34)'), -1234);
  assert.equal(parseAmount('12.34-'), -1234);
  assert.equal(parseAmount('12.34 CR'), 1234);
  assert.equal(parseAmount('12.34 DR'), -1234);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('-$5'), -500);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('0.1') + parseAmount('0.2'), 30); // integer cents, no float drift
});

test('parseDate handles formats and rejects impossible dates', () => {
  assert.equal(parseDate('2024-01-31'), '2024-01-31');
  assert.equal(parseDate('01/31/2024'), '2024-01-31');
  assert.equal(parseDate('31/01/2024', 'DMY'), '2024-01-31');
  assert.equal(parseDate('1/5/24'), '2024-01-05');
  assert.equal(parseDate('20240131120000[-5:EST]'), '2024-01-31');
  assert.equal(parseDate('15-Feb-2024'), '2024-02-15');
  assert.equal(parseDate('Jan 5, 2024'), '2024-01-05');
  assert.equal(parseDate('01/15', 'MDY', 2023), '2023-01-15');
  assert.equal(parseDate('02/30/2024'), null);
  assert.equal(parseDate('20249999'), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(guessDateOrder(['13/01/2024', '05/01/2024']), 'DMY');
});

test('cleanText strips control and bidi-override characters', () => {
  assert.equal(cleanText('a‮gnp.exe\u0007b'), 'agnp.exeb');
});

test('merchantKey normalizes noisy descriptions', () => {
  assert.equal(merchantKey('WHOLE FOODS MARKET #10234 AUSTIN TX'), 'WHOLE FOODS MARKET');
  assert.equal(merchantKey('SQ *BLUE BOTTLE COFFEE'), 'BLUE BOTTLE COFFEE');
  assert.equal(merchantKey('SHELL OIL 57444'), 'SHELL OIL');
});

test('maskDigits keeps the last 4 digits only', () => {
  assert.equal(maskDigits('TRANSFER TO SAVINGS 9900005555'), 'TRANSFER TO SAVINGS ••••5555');
  assert.equal(maskDigits('STORE 123'), 'STORE 123');
});

test('CSV tokenizer handles quotes, escaped quotes, embedded newlines', () => {
  const rows = tokenize('a,"b ""q"", c","line\nbreak"\r\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b "q", c', 'line\nbreak'], ['1', '2', '3']]);
});

test('CSV with hostile descriptions is read as plain text and bad rows skipped', () => {
  const table = readCsv(readFileSync(sample('checking-jan-mar-2024.csv'), 'utf8'));
  assert.equal(table.mappingRecognized, true);
  const { drafts, skipped, resolvedSign } = tableToDrafts(table);
  assert.equal(resolvedSign, 'negOut');
  assert.ok(drafts.some((d) => d.description === '<script>alert(1)</script>'));
  assert.ok(skipped.some((s) => s.reason === 'unreadable date'));
  assert.equal(drafts.find((d) => d.description.startsWith('AMAZON.COM REFUND')).amount, 2399);
});

test('CSV with preamble and separate debit/credit columns', () => {
  const table = readCsv(readFileSync(sample('checking-overlap-feb-mar-2024.csv'), 'utf8'));
  assert.equal(table.headers[0], 'Posting Date');
  const { drafts } = tableToDrafts(table);
  assert.equal(drafts[0].amount, -1199);
  assert.equal(drafts[1].amount, 245000);
});

test('Credit-card CSV with positive purchases is flipped', () => {
  const table = readCsv(readFileSync(sample('creditcard-positive-charges.csv'), 'utf8'));
  const { drafts, resolvedSign } = tableToDrafts(table);
  assert.equal(resolvedSign, 'posOut');
  assert.equal(drafts[0].amount, -15422);
  assert.equal(drafts.find((d) => d.description === 'PAYMENT THANK YOU').amount, 61235);
});

test('Semicolon CSV with day-first dates and decimal commas', () => {
  const table = readCsv(readFileSync(sample('european-semicolon-ddmm.csv'), 'utf8'));
  assert.equal(table.dateOrder, 'DMY');
  const { drafts } = tableToDrafts(table);
  assert.equal(drafts[0].date, '2024-01-03');
  assert.equal(drafts[0].amount, 325000);
  assert.equal(drafts[1].amount, -5430);
});

test('Unrecognized headers require mapping', () => {
  const table = readCsv(readFileSync(sample('unmapped-headers.csv'), 'utf8'));
  assert.equal(table.mappingRecognized, false);
  const { drafts } = tableToDrafts(table, { map: { date: 0, description: 1, amount: 2 } });
  assert.equal(drafts.length, 3);
});

test('OFX SGML and QFX XML parse, entities decode to plain text', () => {
  const cc = parseOfx(readFileSync(sample('visa-card-2024q1.ofx'), 'utf8'));
  assert.equal(cc.accounts[0].isCreditCard, true);
  assert.equal(cc.accounts[0].balance, -118045);
  assert.ok(cc.accounts[0].drafts.some((d) => d.description === "<script>alert('ofx')</script>"));
  assert.equal(cc.accounts[0].skipped, 1);
  const sav = parseOfx(readFileSync(sample('savings-2024q1.qfx'), 'utf8'));
  assert.equal(sav.accounts[0].accountId, '9900005555');
  assert.equal(sav.accounts[0].drafts.length, 7);
  assert.ok(sav.accounts[0].drafts[5].description.includes('<svg onload=alert(1)>'));
});

test('Large SGML OFX parses in linear time', () => {
  let body = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>1</ACCTID></BANKACCTFROM><BANKTRANLIST>';
  for (let i = 0; i < 40000; i++) body += `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240101<TRNAMT>-1.00<FITID>${i}<NAME>X\n`;
  body += '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const t0 = Date.now();
  const r = parseOfx('OFXHEADER:100\n' + body);
  assert.equal(r.accounts[0].drafts.length, 40000);
  assert.ok(Date.now() - t0 < 5000);
});

test('Row limit is enforced', () => {
  const big = 'Date,Description,Amount\n' + '2024-01-01,X,-1\n'.repeat(50100);
  assert.throws(() => readCsv(big), ImportError);
});

test('Sniffing uses content, not extension', () => {
  assert.equal(sniff(new Uint8Array(readFileSync(sample('fake-image-renamed.csv')))).kind, 'image');
  assert.equal(sniff(new TextEncoder().encode('%PDF-1.7 ...')).kind, 'pdf');
  assert.equal(sniff(new TextEncoder().encode('<!doctype html><p>x')).kind, 'markup');
  assert.equal(sniff(new Uint8Array([0x50, 0x4b, 3, 4, 0])).kind, 'zip');
});

test('categorize: word-start matching, user rules win, refunds keep category', () => {
  const defs = defaultRuleList();
  assert.equal(categorize('RENT PAYMENT', -1, [], defs).category, 'Housing');
  assert.equal(categorize('CURRENT ACCOUNT FEE', -1, [], defs).category, 'Fees & interest');
  assert.equal(categorize('BLUE BOTTLE COFFEE', -1, [], defs).category, 'Dining');
  assert.equal(categorize('BLUE BOTTLE COFFEE', -1, [{ pattern: 'blue bottle', category: 'Groceries' }], defs).category, 'Groceries');
  const r = categorize('TARGET RETURN', 2500, [], defs);
  assert.equal(r.category, 'Shopping');
  assert.equal(r.refund, true);
});

test('End-to-end import: duplicates removed, transfers and card payments excluded', async () => {
  clearAll();
  for (const f of ['checking-jan-mar-2024.csv', 'checking-overlap-feb-mar-2024.csv', 'creditcard-positive-charges.csv', 'savings-2024q1.qfx', 'visa-card-2024q1.ofx']) {
    const r = await importFile(state, asFile(f));
    assert.equal(r.needs, null, f);
  }
  const overlapFile = state.files[1];
  const overlapTx = state.transactions.filter((t) => t.fileId === overlapFile.id);
  assert.equal(overlapTx.length, 17);
  assert.ok(overlapTx.every((t) => isExcluded(t)), 'every overlapping row is a duplicate');
  // Both same-day Shell charges in the first file are kept.
  const shell = state.transactions.filter((t) => t.fileId === state.files[0].id && t.merchant === 'SHELL OIL' && t.date === '2024-02-22');
  assert.equal(shell.length, 2);
  assert.ok(shell.every((t) => !isExcluded(t)));
  // Duplicate FITID inside the OFX
  const grille = state.transactions.filter((t) => t.description === 'THE CAPITAL GRILLE');
  assert.equal(grille.length, 2);
  assert.equal(grille.filter((t) => !isExcluded(t)).length, 1, 'a repeated FITID is a duplicate even within one file');
  // Card payments paired and neutral
  const autopay = state.transactions.filter((t) => t.description === 'CHASE CREDIT CRD AUTOPAY' && !isExcluded(t));
  assert.ok(autopay.every((t) => t.category === 'Credit card payment' && t.pairId));
  const savingsIn = state.transactions.filter((t) => t.description.startsWith('TRANSFER FROM CHECKING'));
  assert.ok(savingsIn.every((t) => t.category === 'Transfer'));

  const a = analyze(state);
  assert.ok(a.totalIncome > 0 && a.totalSpend > 0);
  assert.ok(!a.categories.some((c) => c.category === 'Transfer' || c.category === 'Credit card payment'));
  assert.ok(a.subscriptions.some((s) => s.merchant === 'NETFLIX'));
  assert.ok(a.subscriptions.some((s) => s.merchant === 'HULU'));
  const flags = overspendingFlags(a, { Dining: 5000 });
  assert.ok(flags.some((f) => f.type === 'limit' && f.category === 'Dining'));
  assert.ok(flags.some((f) => f.type === 'subscriptions'));
  clearAll();
  assert.equal(state.transactions.length, 0);
});

test('Debt payoff: avalanche never pays more interest than snowball', () => {
  const debts = [
    { id: 1, name: 'Card A', balance: 500000, apr: 24.99, minPayment: 15000 },
    { id: 2, name: 'Car', balance: 1200000, apr: 6.5, minPayment: 30000 },
    { id: 3, name: 'Card B', balance: 120000, apr: 18, minPayment: 4000 },
  ];
  const { avalanche, snowball } = compareStrategies(debts, 20000);
  assert.ok(avalanche.feasible && snowball.feasible);
  assert.ok(avalanche.totalInterest <= snowball.totalInterest);
  assert.equal(snowball.order[0].name, 'Card B');
  const stuck = simulate([{ id: 1, name: 'X', balance: 1000000, apr: 30, minPayment: 1000 }], 0, 'avalanche');
  assert.equal(stuck.feasible, false);
});

test('Budget and goals', () => {
  const analysis = { categories: [{ category: 'Housing', monthly: 140000 }, { category: 'Dining', monthly: 20000 }] };
  const b = suggestBudget(analysis, 500000, '503020');
  assert.equal(b.savings, 100000);
  assert.equal(b.lines.Housing, 250000);
  assert.equal(b.lines.Dining, 150000);
  assert.equal(monthsUntil('2025-01-01', '2024-01-01'), 12);
  const plans = planGoals([{ name: 'Trip', target: 120000, saved: 0, date: '2025-01-01' }, { name: 'Car', target: 1200000, saved: 0, date: '2025-01-01' }], 50000, '2024-01-01');
  assert.equal(plans[0].needed, 10000);
  assert.equal(plans[0].status, 'on-track');
  assert.equal(plans[1].status, 'short');
});

test('PDF text heuristics: statement lines and paystub numbers', () => {
  const lines = [
    'Statement Period 12/01/2023 through 01/05/2024',
    'Purchases',
    '12/28 12/29 WHOLE FOODS #123 AUSTIN TX 54.21',
    '01/02 01/03 NETFLIX.COM 15.49',
    'Payments and Credits',
    '01/03 PAYMENT THANK YOU 300.00',
    'New Balance $1,234.56 Minimum Payment Due $35.00',
    'Annual Percentage Rate (APR) 24.99%',
  ];
  const r = parseStatementLines(lines);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].date, '2023-12-28');
  assert.equal(r.rows[0].amount, -5421);
  assert.equal(r.rows[2].amount, 30000);
  assert.deepEqual(r.debtHint, { balance: 123456, minPayment: 3500, apr: 24.99 });
  const stub = parsePaystubLines(['Pay Period 01/01/2024 - 01/14/2024', 'Gross Pay 3,000.00', 'Federal Income Tax 300.00', 'Medicare 43.50', 'Net Pay 2,200.00']);
  assert.equal(stub.gross, 300000);
  assert.equal(stub.net, 220000);
  assert.equal(stub.frequency, 'biweekly');
  assert.ok(stub.deductions.some((d) => d.name === 'Medicare' && d.amount === 4350));
});

test('Malformed and binary files fail with clear errors', async () => {
  clearAll();
  await assert.rejects(importFile(state, asFile('fake-image-renamed.csv')), /image/i);
  await assert.rejects(importFile(state, asFile('malformed-unclosed-quote.csv')), ImportError);
  await assert.rejects(importFile(state, new File([new Uint8Array(21 * 1024 * 1024)], 'huge.csv')), /limit/);
  clearAll();
});
