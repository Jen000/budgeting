// Debt payoff simulation: avalanche (highest APR first) vs snowball (smallest balance first).

const MAX_MONTHS = 600;

/**
 * debts: [{ id, name, balance (cents), apr (percent, e.g. 24.99), minPayment (cents) }]
 * extra: additional cents per month on top of all minimums.
 * Freed-up minimums roll over to the next target debt.
 */
export function simulate(debts, extra, strategy) {
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.name, balance: d.balance, apr: Math.max(d.apr || 0, 0), min: Math.max(d.minPayment || 0, 0), paidOffMonth: null, interest: 0 }));
  if (!live.length) return { months: 0, totalInterest: 0, totalPaid: 0, order: [], feasible: true };
  const budget = live.reduce((s, d) => s + d.min, 0) + Math.max(extra || 0, 0);
  const firstInterest = live.reduce((s, d) => s + Math.round(d.balance * d.apr / 1200), 0);
  if (budget <= firstInterest) {
    return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, order: [], feasible: false, reason: 'Your total monthly payment does not cover the interest, so the balance would grow.' };
  }
  const rank = (a, b) => strategy === 'avalanche'
    ? (b.apr - a.apr) || (a.balance - b.balance)
    : (a.balance - b.balance) || (b.apr - a.apr);

  let month = 0, totalInterest = 0, totalPaid = 0;
  const order = [];
  while (live.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const i = Math.round(d.balance * d.apr / 1200);
      d.balance += i; d.interest += i; totalInterest += i;
    }
    let pool = budget;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const p = Math.min(d.min, d.balance, pool);
      d.balance -= p; pool -= p; totalPaid += p;
    }
    const targets = live.filter((d) => d.balance > 0).sort(rank);
    for (const d of targets) {
      if (pool <= 0) break;
      const p = Math.min(d.balance, pool);
      d.balance -= p; pool -= p; totalPaid += p;
    }
    for (const d of live) {
      if (d.balance <= 0 && d.paidOffMonth === null) { d.paidOffMonth = month; order.push({ name: d.name, month, interest: d.interest }); }
    }
  }
  const feasible = live.every((d) => d.balance <= 0);
  return { months: feasible ? month : Infinity, totalInterest, totalPaid, order, feasible, reason: feasible ? '' : 'Not paid off within 50 years at this payment.' };
}

export function compareStrategies(debts, extra) {
  return { avalanche: simulate(debts, extra, 'avalanche'), snowball: simulate(debts, extra, 'snowball') };
}

/** Look for balance / APR / minimum payment in statement text (PDF) for the user to confirm. */
export function findDebtHints(text) {
  const grab = (re) => { const m = text.match(re); return m ? m[1] : null; };
  const balance = grab(/(?:new balance|statement balance|current balance|principal balance|outstanding balance)[^\d$]{0,30}\$?\s?([\d,]+\.\d{2})/i);
  const minPay = grab(/(?:minimum payment(?: due)?|amount due|payment due amount)[^\d$]{0,30}\$?\s?([\d,]+\.\d{2})/i);
  const apr = grab(/(?:annual percentage rate|purchase apr|apr|interest rate)[^\d%]{0,40}(\d{1,2}(?:\.\d{1,3})?)\s?%/i);
  if (!balance) return null;
  return {
    balance: Math.round(Number(balance.replace(/,/g, '')) * 100),
    minPayment: minPay ? Math.round(Number(minPay.replace(/,/g, '')) * 100) : null,
    apr: apr ? Number(apr) : null,
  };
}
