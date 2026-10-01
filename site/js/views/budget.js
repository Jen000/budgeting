// Step 4: budget (editable) and debts with an avalanche vs snowball comparison.
import { state, notify } from '../state.js';
import { $, el, clear, field, options, moneyInput, table, statusLabel, idSafe } from '../dom.js';
import { suggestBudget, budgetTotals } from '../budget.js';
import { compareStrategies } from '../debt.js';
import { categoryBucket } from '../categorize.js';
import { formatMoney, parseMoneyInput, cleanText, newId, todayISO, addDays } from '../util.js';
import { getAnalysis, incomeForBudget, allCategories, setStatus, nextButton } from './common.js';

const SOURCE_TEXT = {
  paychecks: 'from the paychecks you entered',
  deposits: 'average deposits found in your statements',
  override: 'typed by you',
};

export function renderBudget() {
  renderBudgetPanel();
  renderDebts();
}

function renderBudgetPanel() {
  const panel = clear($('budget-panel'));
  const a = getAnalysis(state);
  const income = incomeForBudget(state, a);
  const actual = new Map((a ? a.categories : []).map((c) => [c.category, c.monthly]));

  const incomeInput = moneyInput('budget-income', income.amount, (v) => { state.incomeOverride = parseMoneyInput(v); notify(); });
  panel.append(el('div', { class: 'card' },
    field('Monthly take-home income used for budgeting', incomeInput, `Currently ${SOURCE_TEXT[income.source]}. Clear the box to go back to the automatic figure.`)));

  const make = (method) => {
    if (state.budget && !window.confirm('Replace your current budget with a new suggestion?')) return;
    state.budget = suggestBudget(a, income.amount, method);
    setStatus(method === '503020' ? 'Budget created with a 50/30/20 split.' : 'Budget created from your actual spending.');
    notify();
  };
  panel.append(el('p', {}, 'Start from a suggestion, then edit any amount. Your budget amounts also act as monthly limits: categories that go over are flagged on the Insights step.'),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn btn-primary', id: 'budget-actual', disabled: !a, on: { click: () => make('actual') } }, state.budget ? 'Replace with my actual spending' : 'Start from my actual spending'),
      el('button', { type: 'button', class: 'btn', id: 'budget-503020', disabled: !income.amount, on: { click: () => make('503020') } }, state.budget ? 'Replace with 50/30/20 split' : 'Start with a 50/30/20 split')),
    el('details', {}, el('summary', {}, 'What is 50/30/20?'),
      el('p', {}, '50% of take-home pay for needs (housing, utilities, groceries, transport, insurance, minimum debt payments), 30% for wants (dining, shopping, entertainment, subscriptions), and 20% for savings and extra debt payments. It is a starting point, not a rule.')));

  if (!state.budget) {
    if (!a) panel.append(el('p', { class: 'hint' }, 'Upload statements (or enter your paycheck) to get a suggestion.'));
    return;
  }
  const b = state.budget;
  const lines = Object.keys(b.lines);
  const rows = lines.map((cat) => {
    const budgetAmt = b.lines[cat] || 0;
    const act = actual.get(cat) || 0;
    const over = budgetAmt > 0 && act > budgetAmt;
    return el('tr', {},
      el('th', { scope: 'row' }, cat, el('div', { class: 'hint' }, categoryBucket(cat) === 'needs' ? 'Need' : 'Want')),
      el('td', { class: 'num' }, formatMoney(act)),
      el('td', { class: 'num' }, moneyInput(`budget-line-${idSafe(cat)}`, budgetAmt, (v) => { b.lines[cat] = Math.max(parseMoneyInput(v) || 0, 0); notify(); }, { 'aria-label': `Monthly budget for ${cat}`, class: 'input-money' })),
      el('td', {}, over ? statusLabel('serious', `Over by ${formatMoney(act - budgetAmt)}`) : (budgetAmt ? statusLabel('good', 'Within budget') : '—')),
      el('td', {}, el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', 'aria-label': `Remove ${cat} from budget`, on: { click: () => { delete b.lines[cat]; notify(); } } }, 'Remove')));
  });
  const savingsRow = el('tr', { class: 'row-savings' },
    el('th', { scope: 'row' }, 'Savings & extra debt payments'),
    el('td', { class: 'num' }, '—'),
    el('td', { class: 'num' }, moneyInput('budget-savings', b.savings, (v) => { b.savings = Math.max(parseMoneyInput(v) || 0, 0); notify(); }, { 'aria-label': 'Monthly savings', class: 'input-money' })),
    el('td', {}, 'Funds your goals'), el('td', {}));

  const missing = allCategories(state).filter((c) => !lines.includes(c) && !['Paycheck', 'Other income', 'Transfer', 'Credit card payment'].includes(c));
  const addSel = el('select', { id: 'budget-add-cat' }, options(missing));
  const t = budgetTotals(b, income.amount);
  const needs = lines.filter((c) => categoryBucket(c) === 'needs').reduce((s, c) => s + (b.lines[c] || 0), 0);
  const wants = t.spending - needs;
  const pct = (v) => (income.amount ? `${Math.round((v / income.amount) * 100)}%` : '—');

  panel.append(
    el('div', { class: 'table-wrap' }, el('table', { class: 'data budget' },
      el('caption', {}, 'Monthly budget'),
      el('thead', {}, el('tr', {}, ['Category', 'Actual / month', 'Budget / month', 'Status', ''].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows, savingsRow))),
    missing.length ? el('div', { class: 'inline-form' }, field('Add a category to the budget', addSel),
      el('button', { type: 'button', class: 'btn', on: { click: () => { b.lines[addSel.value] = 0; notify(); } } }, 'Add')) : null,
    table({
      caption: 'Budget totals',
      headers: ['', 'Per month', 'Share of income'],
      numeric: [1, 2],
      rows: [
        ['Take-home income', formatMoney(income.amount), '100%'],
        ['Needs', formatMoney(needs), pct(needs)],
        ['Wants', formatMoney(wants), pct(wants)],
        ['Savings & extra debt payments', formatMoney(t.savings), pct(t.savings)],
        ['Not yet assigned', formatMoney(t.unallocated, { sign: true }), pct(t.unallocated)],
      ],
    }),
    t.unallocated < 0
      ? el('p', {}, statusLabel('critical', `This budget is ${formatMoney(-t.unallocated)} more than your income. Lower some amounts.`))
      : el('p', {}, statusLabel('good', `Balanced. ${formatMoney(t.available)} per month is available for savings goals.`)),
    nextButton('Continue to goals →', 'goals'));
}

// ---------- debts ----------

function blankDebt() { return { name: '', balance: null, apr: null, minPayment: null }; }

function parseApr(v) {
  const n = Number(String(v).replace(/[%\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}

function renderDebts() {
  const panel = clear($('debts-panel'));
  panel.append(el('p', {}, 'Add each loan or card balance. Interest rates are rarely in exports, so enter the APR from your statement or lender.'));

  if (state.debtSuggestions.length) {
    panel.append(el('div', { class: 'card card-attention' }, el('h4', {}, 'Balances found in your statements'),
      el('ul', { class: 'rule-list' }, state.debtSuggestions.map((s) => el('li', {},
        el('span', {}, `${s.name}: ${formatMoney(s.balance)}${s.apr ? `, APR ${s.apr}%` : ''}${s.minPayment ? `, minimum ${formatMoney(s.minPayment)}` : ''} (from ${s.source})`),
        el('span', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn btn-small', on: { click: () => {
            state.debts.push({ id: newId('d'), name: s.name, balance: s.balance, apr: s.apr, minPayment: s.minPayment, source: s.source });
            state.debtSuggestions = state.debtSuggestions.filter((x) => x !== s);
            setStatus(`${s.name} added. Check its APR and minimum payment.`);
            notify();
          } } }, 'Add'),
          el('button', { type: 'button', class: 'btn btn-small', on: { click: () => { state.debtSuggestions = state.debtSuggestions.filter((x) => x !== s); notify(); } } }, 'Ignore')))))));
  }

  if (state.debts.length) {
    const rows = state.debts.map((d) => el('tr', {},
      el('th', { scope: 'row' }, el('input', { id: `debt-name-${d.id}`, type: 'text', autocomplete: 'off', value: d.name, 'aria-label': 'Debt name', on: { change: (e) => { d.name = cleanText(e.target.value, 60) || d.name; notify(); } } })),
      el('td', {}, moneyInput(`debt-bal-${d.id}`, d.balance, (v) => { d.balance = Math.max(parseMoneyInput(v) || 0, 0); notify(); }, { 'aria-label': `Balance of ${d.name}`, class: 'input-money' })),
      el('td', {}, el('input', { id: `debt-apr-${d.id}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-small', value: d.apr ?? '', 'aria-label': `APR percent for ${d.name}`, on: { change: (e) => { d.apr = parseApr(e.target.value); notify(); } } })),
      el('td', {}, moneyInput(`debt-min-${d.id}`, d.minPayment, (v) => { d.minPayment = Math.max(parseMoneyInput(v) || 0, 0); notify(); }, { 'aria-label': `Minimum payment for ${d.name}`, class: 'input-money' })),
      el('td', {}, d.apr === null || d.apr === undefined ? statusLabel('warning', 'Enter APR') : (!d.minPayment ? statusLabel('warning', 'Enter minimum') : '')),
      el('td', {}, el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', 'aria-label': `Remove ${d.name}`, on: { click: () => { state.debts = state.debts.filter((x) => x !== d); notify(); } } }, 'Remove'))));
    panel.append(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('caption', {}, 'Your debts'),
      el('thead', {}, el('tr', {}, ['Name', 'Balance', 'APR %', 'Minimum / month', '', ''].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows))));
  }

  if (!state.drafts.debt) state.drafts.debt = blankDebt();
  const dd = state.drafts.debt;
  const errBox = el('div', { role: 'alert' });
  panel.append(el('form', { class: 'card', autocomplete: 'off', novalidate: true, 'aria-label': 'Add a debt', on: { submit: (e) => {
    e.preventDefault();
    const problems = [];
    if (!dd.name) problems.push('Give the debt a name.');
    if (!dd.balance || dd.balance <= 0) problems.push('Enter the balance.');
    if (dd.apr === null) problems.push('Enter the interest rate (APR), e.g. 22.99. Use 0 for interest-free.');
    if (problems.length) { errBox.replaceChildren(...problems.map((p) => el('p', { class: 'notice notice-critical' }, p))); return; }
    state.debts.push({ id: newId('d'), name: dd.name, balance: dd.balance, apr: dd.apr, minPayment: dd.minPayment || 0, source: 'manual' });
    state.drafts.debt = blankDebt();
    notify();
  } } },
    el('h4', {}, 'Add a debt'),
    el('div', { class: 'grid-4' },
      field('Name', el('input', { id: 'debt-new-name', type: 'text', autocomplete: 'off', value: dd.name, on: { change: (e) => { dd.name = cleanText(e.target.value, 60); } } })),
      field('Balance', moneyInput('debt-new-bal', dd.balance, (v) => { dd.balance = parseMoneyInput(v); })),
      field('APR %', el('input', { id: 'debt-new-apr', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: dd.apr ?? '', on: { change: (e) => { dd.apr = parseApr(e.target.value); } } })),
      field('Minimum payment / month', moneyInput('debt-new-min', dd.minPayment, (v) => { dd.minPayment = parseMoneyInput(v); }))),
    errBox,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add debt')));

  if (!state.debts.length) return;
  panel.append(el('div', { class: 'card' }, field('Extra payment per month, on top of all minimums', moneyInput('debt-extra', state.extraDebtPayment, (v) => { state.extraDebtPayment = Math.max(parseMoneyInput(v) || 0, 0); notify(); }), 'Try different amounts to see how much sooner you would be debt-free.')));
  panel.append(debtComparison(state));
}

function freeDate(months) {
  if (!Number.isFinite(months)) return 'Never at this payment';
  const d = addDays(todayISO(), Math.round(months * 30.4375));
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function debtComparison(st) {
  const debts = st.debts.map((d) => ({ ...d, apr: d.apr ?? 0 }));
  const { avalanche, snowball } = compareStrategies(debts, st.extraDebtPayment);
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const mins = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  const fmtMonths = (r) => (r.feasible ? `${r.months} months` : 'Not paid off');
  const wrap = el('div', {});
  wrap.append(table({
    caption: `Payoff comparison: ${formatMoney(total)} owed, paying ${formatMoney(mins + st.extraDebtPayment)} per month`,
    headers: ['Strategy', 'How it works', 'Debt-free in', 'Debt-free by', 'Total interest', 'Payoff order'],
    numeric: [4],
    rows: [
      ['Avalanche', 'Extra money goes to the highest interest rate first', fmtMonths(avalanche), freeDate(avalanche.months), avalanche.feasible ? formatMoney(avalanche.totalInterest) : '—', avalanche.order.map((o) => o.name).join(' → ') || '—'],
      ['Snowball', 'Extra money goes to the smallest balance first', fmtMonths(snowball), freeDate(snowball.months), snowball.feasible ? formatMoney(snowball.totalInterest) : '—', snowball.order.map((o) => o.name).join(' → ') || '—'],
    ],
  }));
  if (!avalanche.feasible) {
    wrap.append(el('p', {}, statusLabel('critical', avalanche.reason || 'At these payments the debts are never paid off. Increase the payments.')));
  } else {
    const saved = snowball.totalInterest - avalanche.totalInterest;
    const firstWin = (r) => (r.order[0] ? r.order[0].month : null);
    wrap.append(el('p', {}, saved > 0
      ? `Avalanche saves about ${formatMoney(saved)} in interest. Snowball clears its first debt in month ${firstWin(snowball)} (vs month ${firstWin(avalanche)}), which some people find motivating.`
      : 'Both strategies cost about the same here. Pick whichever keeps you motivated.'));
    if (debts.some((d) => !d.apr)) wrap.append(el('p', { class: 'hint' }, 'Debts without an APR are treated as 0% interest.'));
  }
  return wrap;
}
