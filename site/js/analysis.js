// Aggregations and overspending flags. Pure functions over the in-memory state.
import { monthKey, monthsSpan, daysBetween, sum } from './util.js';
import { classify } from './ledger.js';
import { categoryBucket } from './categorize.js';

/** Everything the Insights, Budget and Report steps need, computed in one pass. */
export function analyze(state) {
  const spend = [], income = [];
  let neutralCount = 0, cardPayments = 0;
  for (const t of state.transactions) {
    const c = classify(t, state.customCategories);
    if (c === 'spend') spend.push(t);
    else if (c === 'income') income.push(t);
    else if (c === 'neutral') { neutralCount++; if (t.category === 'Credit card payment' && t.amount < 0) cardPayments += -t.amount; }
  }
  const counted = [...spend, ...income];
  if (!counted.length) return null;

  const dates = counted.map((t) => t.date).sort();
  const from = dates[0], to = dates[dates.length - 1];
  const months = monthList(from, to);
  const span = Math.max(monthsSpan(from, to), 1);

  const byCategory = new Map();
  const byMerchant = new Map();
  const byMonth = new Map(months.map((m) => [m, { month: m, spend: 0, income: 0 }]));
  const catMonth = new Map(); // category -> Map(month -> cents)

  for (const t of spend) {
    const out = -t.amount; // refunds (positive amounts) reduce spending
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + out);
    const m = byMerchant.get(t.merchant) || { merchant: t.merchant, total: 0, count: 0, category: t.category };
    m.total += out; m.count++;
    byMerchant.set(t.merchant, m);
    const mk = monthKey(t.date);
    byMonth.get(mk).spend += out;
    if (!catMonth.has(t.category)) catMonth.set(t.category, new Map());
    const cm = catMonth.get(t.category);
    cm.set(mk, (cm.get(mk) || 0) + out);
  }
  const incomeByCategory = new Map();
  for (const t of income) {
    byMonth.get(monthKey(t.date)).income += t.amount;
    incomeByCategory.set(t.category, (incomeByCategory.get(t.category) || 0) + t.amount);
  }

  const totalSpend = sum(spend, (t) => -t.amount);
  const totalIncome = sum(income, (t) => t.amount);
  const categories = [...byCategory.entries()]
    .map(([category, total]) => ({ category, total, monthly: Math.round(total / span) }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total);
  const merchants = [...byMerchant.values()].filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  const complete = completeMonths(months, from, to);

  return {
    from, to, months, span, complete,
    totalSpend, totalIncome,
    monthlySpend: Math.round(totalSpend / span),
    monthlyIncome: Math.round(totalIncome / span),
    categories, merchants,
    incomeSources: [...incomeByCategory.entries()].map(([category, total]) => ({ category, total })),
    byMonth: [...byMonth.values()],
    catMonth,
    spendTransactions: spend,
    neutralCount,
    cardPayments,
    hasCardFile: state.files.some((f) => f.isCreditCard),
    subscriptions: findSubscriptions(spend),
  };
}

export function monthList(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Months fully covered by the data (first/last month count only if nearly complete). */
export function completeMonths(months, from, to) {
  return months.filter((mk, i) => {
    if (i === 0 && Number(from.slice(8, 10)) > 5) return false;
    if (i === months.length - 1) {
      const [y, m] = mk.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (Number(to.slice(8, 10)) < last - 5) return false;
    }
    return true;
  });
}

const CADENCES = [
  { name: 'weekly', min: 6, max: 8, perYear: 52 },
  { name: 'every 2 weeks', min: 13, max: 16, perYear: 26 },
  { name: 'monthly', min: 26, max: 35, perYear: 12 },
  { name: 'quarterly', min: 84, max: 98, perYear: 4 },
  { name: 'yearly', min: 350, max: 380, perYear: 1 },
];

/** Recurring charges: same merchant, similar amount, regular interval. */
export function findSubscriptions(spend) {
  const byMerchant = new Map();
  for (const t of spend) {
    // Rent, utilities, groceries, loan payments etc. recur too, but they are bills, not subscriptions.
    if (t.amount >= 0 || (categoryBucket(t.category) !== 'wants' && t.category !== 'Subscriptions')) continue;
    if (!byMerchant.has(t.merchant)) byMerchant.set(t.merchant, []);
    byMerchant.get(t.merchant).push(t);
  }
  const subs = [];
  for (const [merchant, list] of byMerchant) {
    const isSubCat = list.some((t) => t.category === 'Subscriptions');
    if (list.length < 2 && !isSubCat) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = list.map((t) => -t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = list.filter((t) => Math.abs(-t.amount - median) <= Math.max(median * 0.03, 50));
    if (similar.length < 2) {
      if (isSubCat) subs.push({ merchant, amount: median, cadence: 'unknown', perYear: 12, annual: median * 12, count: list.length, last: list[list.length - 1].date, category: list[0].category });
      continue;
    }
    const gaps = [];
    for (let i = 1; i < similar.length; i++) gaps.push(daysBetween(similar[i - 1].date, similar[i].date));
    gaps.sort((a, b) => a - b);
    const g = gaps[Math.floor(gaps.length / 2)];
    const cadence = CADENCES.find((c) => g >= c.min && g <= c.max);
    if (!cadence) continue;
    // Groceries every week at the same store is a habit, not a subscription, unless amounts are identical.
    const identical = similar.every((t) => t.amount === similar[0].amount);
    if (!identical && !isSubCat && cadence.perYear > 12) continue;
    subs.push({
      merchant,
      amount: median,
      cadence: cadence.name,
      perYear: cadence.perYear,
      annual: median * cadence.perYear,
      count: similar.length,
      last: similar[similar.length - 1].date,
      category: similar[0].category,
    });
  }
  return subs.sort((a, b) => b.annual - a.annual);
}

/**
 * Overspending flags.
 * limits: { [category]: monthly cents } (from the budget).
 */
export function overspendingFlags(a, limits = {}) {
  const flags = [];
  if (!a) return flags;
  const recent = a.complete.length ? a.complete : a.months;
  const latest = recent[recent.length - 1];
  const prev = recent.length > 1 ? recent[recent.length - 2] : null;

  // 1. Over the user-set limit
  for (const [category, limit] of Object.entries(limits)) {
    if (!limit || limit <= 0) continue;
    const cm = a.catMonth.get(category);
    if (!cm) continue;
    const latestAmt = cm.get(latest) || 0;
    const avg = Math.round([...cm.values()].reduce((s, v) => s + v, 0) / a.span);
    if (latestAmt > limit || avg > limit) {
      flags.push({ type: 'limit', severity: 'serious', category, limit, latest: latestAmt, month: latest, avg });
    }
  }

  // 2. Month-over-month growth
  if (prev) {
    for (const [category, cm] of a.catMonth) {
      const cur = cm.get(latest) || 0, before = cm.get(prev) || 0;
      if (cur - before >= 5000 && before > 0 && cur / before >= 1.25) {
        flags.push({ type: 'growth', severity: 'warning', category, month: latest, prevMonth: prev, current: cur, previous: before, pct: Math.round((cur / before - 1) * 100) });
      } else if (before === 0 && cur >= 10000 && a.months.length > 2) {
        flags.push({ type: 'growth', severity: 'warning', category, month: latest, prevMonth: prev, current: cur, previous: 0, pct: null });
      }
    }
  }

  // 3. Subscriptions
  if (a.subscriptions.length) {
    flags.push({ type: 'subscriptions', severity: 'info', count: a.subscriptions.length, annual: sum(a.subscriptions, (s) => s.annual) });
  }

  // 4. Spending above income
  const overMonths = a.byMonth.filter((m) => m.spend > m.income && a.complete.includes(m.month));
  if (a.totalSpend > a.totalIncome) {
    flags.push({ type: 'deficit', severity: 'critical', spend: a.totalSpend, income: a.totalIncome, months: overMonths.map((m) => m.month) });
  } else if (overMonths.length) {
    flags.push({ type: 'deficit-months', severity: 'warning', months: overMonths.map((m) => m.month) });
  }
  const order = { critical: 0, serious: 1, warning: 2, info: 3 };
  return flags.sort((x, y) => order[x.severity] - order[y.severity]);
}
