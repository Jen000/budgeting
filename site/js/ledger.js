// Turns parser output into transactions, then reconciles them:
// categorization, cross-file duplicate removal, and transfer / card-payment pairing.
import { LIMITS, merchantKey, newId, daysBetween } from './util.js';
import { categorize, categoryKind, NEUTRAL } from './categorize.js';

/** Add drafts from one file. Returns the number added. */
export function addDrafts(state, file, drafts) {
  const room = LIMITS.maxTotalTransactions - state.transactions.length;
  if (room <= 0) throw new Error(`You have reached the limit of ${LIMITS.maxTotalTransactions.toLocaleString()} transactions. Clear some files first.`);
  const take = drafts.slice(0, room);
  take.forEach((d, i) => {
    state.transactions.push({
      id: newId('t'),
      fileId: file.id,
      order: i,
      date: d.date,
      description: d.description,
      amount: d.amount,
      account: d.account || file.accountLabel || '',
      fitid: d.fitid || '',
      merchant: merchantKey(d.description),
      category: 'Other',
      categorySource: 'auto', // 'auto' | 'user'
      refund: false,
      autoExclude: null,      // null | 'duplicate' | 'transfer-pair'
      userInclude: null,      // null = follow auto; true/false = user override
      pairId: null,
    });
  });
  return take.length;
}

export function isExcluded(t) {
  if (t.userInclude === true) return false;
  if (t.userInclude === false) return true;
  return t.autoExclude === 'duplicate';
}

/** Re-run categorization (for non-user-set categories), dedupe and transfer pairing. */
export function reconcile(state) {
  const fileOrder = new Map(state.files.map((f, i) => [f.id, i]));
  const fileById = new Map(state.files.map((f) => [f.id, f]));
  // Drop transactions whose file was removed.
  state.transactions = state.transactions.filter((t) => fileOrder.has(t.fileId));
  state.transactions.sort((a, b) => (fileOrder.get(a.fileId) - fileOrder.get(b.fileId)) || (a.order - b.order));

  for (const t of state.transactions) {
    t.autoExclude = null;
    t.pairId = null;
    if (t.categorySource === 'user') continue;
    const r = categorize(`${t.description} | ${t.merchant}`, t.amount, state.userRules, state.defaultRules);
    t.category = r.category;
    t.refund = !!r.refund;
    const file = fileById.get(t.fileId);
    // On a credit card, an unmatched inflow that mentions "pay" is a card payment.
    if (file?.isCreditCard && t.amount > 0 && !r.rule && /\bpay/i.test(t.description)) {
      t.category = 'Credit card payment';
      t.refund = false;
    }
  }
  markDuplicates(state.transactions);
  pairTransfers(state.transactions, fileById);
}

/**
 * Cross-file duplicates: same date, amount and merchant, from a different file, with compatible
 * accounts. Each original can absorb at most one copy per other file, so two genuine identical
 * purchases on the same day in the same file are both kept.
 */
export function markDuplicates(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.fitid) {
      const fk = `fitid|${t.account}|${t.fitid}`;
      const prior = groups.get(fk);
      // FITIDs are unique per account by the OFX spec, so a repeat is a duplicate even within one file.
      if (prior) { t.autoExclude = 'duplicate'; t.dupOf = prior[0].id; continue; }
      groups.set(fk, [t]);
    }
    const key = `${t.date}|${t.amount}|${t.merchant}`;
    let kept = groups.get(key);
    if (!kept) { kept = []; groups.set(key, kept); }
    const match = kept.find((k) => k.fileId !== t.fileId && !k.matchedBy.has(t.fileId) && accountsCompatible(k.account, t.account));
    if (match) {
      match.matchedBy.add(t.fileId);
      t.autoExclude = 'duplicate';
      t.dupOf = match.t.id;
    } else {
      kept.push({ t, fileId: t.fileId, account: t.account, matchedBy: new Set() });
    }
  }
}

function accountsCompatible(a, b) {
  if (!a || !b) return true;
  return a.replace(/\W/g, '').slice(-4) === b.replace(/\W/g, '').slice(-4);
}

const TRANSFERISH = /\b(transfer|xfer|trnsfr|payment|pmt|autopay|epay|thank you|to sav|from sav|to chk|from chk|zelle|venmo)/i;

/**
 * Pair an outflow in one file with an equal inflow in another file within 5 days.
 * Only pairs when one side looks like a transfer/payment or one side is a credit card,
 * so a paycheck is never paired with an unrelated purchase.
 */
export function pairTransfers(transactions, fileById) {
  const live = transactions.filter((t) => !isExcluded(t));
  const inflowsByAmount = new Map();
  for (const t of live) {
    if (t.amount > 0) {
      const list = inflowsByAmount.get(t.amount) || [];
      list.push(t);
      inflowsByAmount.set(t.amount, list);
    }
  }
  for (const out of live) {
    if (out.amount >= 0 || out.pairId) continue;
    const candidates = inflowsByAmount.get(-out.amount) || [];
    let best = null;
    for (const inn of candidates) {
      if (inn.pairId || inn.fileId === out.fileId) continue;
      if (out.account && inn.account && accountsCompatible(out.account, inn.account)) continue;
      const gap = Math.abs(daysBetween(out.date, inn.date));
      if (gap > 5) continue;
      const outFile = fileById.get(out.fileId), inFile = fileById.get(inn.fileId);
      const plausible = NEUTRAL.has(out.category) || NEUTRAL.has(inn.category) ||
        TRANSFERISH.test(out.description) || TRANSFERISH.test(inn.description) ||
        outFile?.isCreditCard || inFile?.isCreditCard;
      if (!plausible) continue;
      if (!best || gap < best.gap) best = { inn, gap };
    }
    if (!best) continue;
    const inn = best.inn;
    const toCard = fileById.get(inn.fileId)?.isCreditCard || out.category === 'Credit card payment' || inn.category === 'Credit card payment';
    const cat = toCard ? 'Credit card payment' : 'Transfer';
    out.pairId = inn.id;
    inn.pairId = out.id;
    for (const t of [out, inn]) {
      t.autoExclude = t.autoExclude || 'transfer-pair';
      if (t.categorySource !== 'user') { t.category = cat; t.refund = false; }
    }
  }
}

/** Transactions that count, with their effect classified. */
export function classify(t, customCategories = []) {
  if (isExcluded(t)) return 'excluded';
  const kind = categoryKind(t.category, customCategories);
  if (kind === 'neutral') return 'neutral';
  if (kind === 'income') return t.amount > 0 ? 'income' : 'spend';
  return 'spend'; // spending; positive amounts here are refunds that reduce spending
}
