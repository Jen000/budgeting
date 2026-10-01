// Budget suggestion and savings-goal math.
import { categoryBucket } from './categorize.js';
import { todayISO } from './util.js';

export const FREQUENCIES = {
  weekly: { label: 'Weekly', perYear: 52 },
  biweekly: { label: 'Every 2 weeks', perYear: 26 },
  semimonthly: { label: 'Twice a month', perYear: 24 },
  monthly: { label: 'Monthly', perYear: 12 },
  annually: { label: 'Yearly', perYear: 1 },
};

export function monthlyFromPaycheck(p) {
  const f = FREQUENCIES[p.frequency] || FREQUENCIES.monthly;
  return Math.round((p.net || 0) * f.perYear / 12);
}

/** Monthly take-home income: paychecks entered by the user win; otherwise observed deposits. */
export function monthlyIncome(state, analysis) {
  if (state.paychecks.length) return { amount: state.paychecks.reduce((s, p) => s + monthlyFromPaycheck(p), 0), source: 'paychecks' };
  return { amount: analysis ? analysis.monthlyIncome : 0, source: 'deposits' };
}

function roundUp(cents, step = 500) { return Math.ceil(cents / step) * step; }

/**
 * method 'actual': each category at its monthly average (rounded up to $5).
 * method '503020': 50% needs / 30% wants / 20% savings of income, split across categories by
 * their share of actual spending in that bucket.
 */
export function suggestBudget(analysis, income, method) {
  const lines = {};
  const cats = analysis ? analysis.categories.filter((c) => c.monthly > 0) : [];
  if (method === '503020') {
    const shares = { needs: 0.5, wants: 0.3 };
    for (const bucket of ['needs', 'wants']) {
      const inBucket = cats.filter((c) => (categoryBucket(c.category) || 'wants') === bucket);
      const total = inBucket.reduce((s, c) => s + c.monthly, 0);
      const pot = Math.round(income * shares[bucket]);
      for (const c of inBucket) lines[c.category] = total ? Math.floor((pot * c.monthly / total) / 100) * 100 : 0;
    }
    return { method, lines, savings: Math.round(income * 0.2) };
  }
  for (const c of cats) lines[c.category] = roundUp(c.monthly);
  const spent = Object.values(lines).reduce((s, v) => s + v, 0);
  return { method: 'actual', lines, savings: Math.max(income - spent, 0) };
}

export function budgetTotals(budget, income) {
  if (!budget) return { spending: 0, savings: 0, unallocated: income, available: income };
  const spending = Object.values(budget.lines).reduce((s, v) => s + (v || 0), 0);
  const savings = budget.savings || 0;
  const unallocated = income - spending - savings;
  return { spending, savings, unallocated, available: savings + Math.max(unallocated, 0) };
}

/** Whole months from today until the target date (at least 1). */
export function monthsUntil(dateISO, fromISO = todayISO()) {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = dateISO.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(months, 1);
}

/**
 * Plan goals in date order against the monthly amount available for saving.
 * Returns [{ goal, months, needed, funded, shortfall, status }].
 */
export function planGoals(goals, available, fromISO = todayISO()) {
  let left = Math.max(available, 0);
  return [...goals]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((goal) => {
      const remaining = Math.max(goal.target - (goal.saved || 0), 0);
      const past = goal.date <= fromISO;
      const months = monthsUntil(goal.date, fromISO);
      const needed = remaining === 0 ? 0 : Math.ceil(remaining / months);
      const funded = Math.min(needed, left);
      left -= funded;
      const shortfall = needed - funded;
      let status = 'on-track';
      if (remaining === 0) status = 'reached';
      else if (past) status = 'past';
      else if (shortfall > 0) status = 'short';
      return { goal, months, remaining, needed, funded, shortfall, status };
    });
}
