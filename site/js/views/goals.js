// Step 5: savings goals, checked against what the budget leaves for saving.
import { state, notify } from '../state.js';
import { $, el, clear, field, moneyInput, table, statusLabel } from '../dom.js';
import { budgetTotals, planGoals } from '../budget.js';
import { formatMoney, formatDate, parseMoneyInput, parseDate, cleanText, newId, todayISO, addDays } from '../util.js';
import { getAnalysis, incomeForBudget, nextButton } from './common.js';

/** Monthly amount available for goals, and where that number comes from. */
export function goalCapacity(st) {
  const a = getAnalysis(st);
  const income = incomeForBudget(st, a);
  if (st.budget) return { amount: budgetTotals(st.budget, income.amount).available, source: 'your budget (savings line plus anything not yet assigned)' };
  if (a) return { amount: Math.max(income.amount - a.monthlySpend, 0), source: 'income minus your average spending (make a budget for a better figure)' };
  return { amount: 0, source: 'no data yet' };
}

const STATUS = {
  'on-track': ['good', 'On track'],
  reached: ['good', 'Reached'],
  short: ['serious', 'Not covered by budget'],
  past: ['warning', 'Target date has passed'],
};

export function goalsTable(st) {
  const cap = goalCapacity(st);
  const plans = planGoals(st.goals, cap.amount);
  return { cap, plans, node: table({
    caption: 'Savings goals',
    headers: ['Goal', 'Target', 'Saved so far', 'Target date', 'Months left', 'Needed / month', 'Status'],
    numeric: [1, 2, 4, 5],
    rows: plans.map((p) => [p.goal.name, formatMoney(p.goal.target), formatMoney(p.goal.saved || 0), formatDate(p.goal.date), String(p.months), formatMoney(p.needed),
      statusLabel(STATUS[p.status][0], STATUS[p.status][1] + (p.status === 'short' ? `: short ${formatMoney(p.shortfall)}/month` : ''))]),
  }) };
}

function blankGoal() { return { name: '', target: null, saved: null, date: addDays(todayISO(), 365) }; }

export function renderGoals() {
  const panel = clear($('goals-panel'));
  const cap = goalCapacity(state);
  panel.append(el('div', { class: 'tiles' }, el('div', { class: 'tile' },
    el('p', { class: 'tile-label' }, 'Available for goals each month'),
    el('p', { class: 'tile-value' }, formatMoney(cap.amount)),
    el('p', { class: 'tile-sub' }, `Based on ${cap.source}.`))));

  if (state.goals.length) {
    const { plans, node } = goalsTable(state);
    const needed = plans.reduce((s, p) => s + p.needed, 0);
    panel.append(node,
      el('p', {}, needed <= cap.amount
        ? statusLabel('good', `Your goals need ${formatMoney(needed)} per month, and ${formatMoney(cap.amount)} is available.`)
        : statusLabel('serious', `Your goals need ${formatMoney(needed)} per month, but only ${formatMoney(cap.amount)} is available. Move a date later, lower a target, or trim the budget. Goals are funded in date order.`)),
      el('ul', { class: 'rule-list' }, state.goals.map((g) => el('li', {}, el('span', {}, g.name),
        el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', 'aria-label': `Remove goal ${g.name}`, on: { click: () => { state.goals = state.goals.filter((x) => x !== g); notify(); } } }, 'Remove')))));
  }

  if (!state.drafts.goal) state.drafts.goal = blankGoal();
  const d = state.drafts.goal;
  const errBox = el('div', { role: 'alert' });
  panel.append(el('form', { class: 'card', autocomplete: 'off', novalidate: true, 'aria-label': 'Add a savings goal', on: { submit: (e) => {
    e.preventDefault();
    const problems = [];
    if (!d.name) problems.push('Give the goal a name.');
    if (!d.target || d.target <= 0) problems.push('Enter a target amount.');
    if (!d.date || d.date <= todayISO()) problems.push('Choose a target date in the future.');
    if (problems.length) { errBox.replaceChildren(...problems.map((p) => el('p', { class: 'notice notice-critical' }, p))); return; }
    state.goals.push({ id: newId('g'), name: d.name, target: d.target, saved: d.saved || 0, date: d.date });
    state.drafts.goal = blankGoal();
    notify();
  } } },
    el('h3', {}, 'Add a goal'),
    el('div', { class: 'grid-4' },
      field('Goal name', el('input', { id: 'goal-name', type: 'text', autocomplete: 'off', value: d.name, on: { change: (e) => { d.name = cleanText(e.target.value, 60); } } }), 'e.g. Emergency fund'),
      field('Target amount', moneyInput('goal-target', d.target, (v) => { d.target = parseMoneyInput(v); })),
      field('Already saved', moneyInput('goal-saved', d.saved, (v) => { d.saved = parseMoneyInput(v); })),
      field('Target date', el('input', { id: 'goal-date', type: 'date', value: d.date, min: addDays(todayISO(), 1), on: { change: (e) => { d.date = parseDate(e.target.value) || d.date; } } }))),
    errBox,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add goal')),
  nextButton('Continue to export →', 'export'));
}
