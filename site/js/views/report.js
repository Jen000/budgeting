// Step 6: the printable report. Built with the same safe DOM helpers; printed via window.print().
import { state } from '../state.js';
import { $, el, clear, table } from '../dom.js';
import { overspendingFlags } from '../analysis.js';
import { budgetTotals, FREQUENCIES, monthlyFromPaycheck } from '../budget.js';
import { formatMoney, formatDate, todayISO } from '../util.js';
import { getAnalysis, incomeForBudget, accountText, descText } from './common.js';
import { flagList, categoryFigure, categoryTable, monthFigure, monthTable, merchantTable, subscriptionTable, summaryTiles, analysisNotices } from './insights.js';
import { debtComparison } from './budget.js';
import { goalsTable } from './goals.js';

function section(title, ...children) {
  return el('section', { class: 'report-section' }, el('h3', {}, title), ...children);
}

export function renderReport() {
  const root = clear($('report'));
  const a = getAnalysis(state);
  const income = incomeForBudget(state, a);
  const parts = [];

  parts.push(el('header', { class: 'report-header' },
    el('h2', {}, 'Personal budget report'),
    el('p', {}, `Prepared ${formatDate(todayISO())}${a ? ` · Covers ${formatDate(a.from)} – ${formatDate(a.to)}` : ''}`),
    el('p', { class: 'hint' }, 'Created privately in your browser. No data was uploaded anywhere.')));

  if (!a && !state.paychecks.length && !state.debts.length && !state.goals.length) {
    parts.push(el('p', { class: 'empty' }, 'Nothing to report yet. Upload statements or enter your paycheck, debts or goals first.'));
    root.append(...parts);
    return;
  }

  if (state.files.length) {
    parts.push(section('Files included', table({
      headers: ['File', 'Type', 'Account', 'Transactions'],
      numeric: [3],
      rows: state.files.map((f) => [descText(state, f.name, true), f.format + (f.isCreditCard ? ' (credit card)' : ''), accountText(state, f.accountLabel, true) || '—', String(f.count)]),
    })));
  }

  // Income
  const incomeParts = [];
  if (a) incomeParts.push(summaryTiles(a));
  if (state.paychecks.length) {
    incomeParts.push(table({
      caption: 'Paychecks',
      headers: ['Name', 'Gross / paycheck', 'Net / paycheck', 'Frequency', 'Net per month'],
      numeric: [1, 2, 4],
      rows: state.paychecks.map((p) => [p.label || 'Paycheck', formatMoney(p.gross), formatMoney(p.net), FREQUENCIES[p.frequency]?.label || '', formatMoney(monthlyFromPaycheck(p))]),
    }));
  }
  incomeParts.push(el('p', {}, `Monthly take-home used for budgeting: ${formatMoney(income.amount)}.`));
  parts.push(section('Income summary', ...incomeParts));

  if (a) {
    parts.push(section('Things to look at', ...analysisNotices(a), flagList(overspendingFlags(a, state.budget ? state.budget.lines : {}))));
    parts.push(section('Spending by category', categoryFigure(a), categoryTable(a)));
    parts.push(section('Month by month', monthFigure(a), monthTable(a)));
    parts.push(section('Top merchants', merchantTable(a, 10)));
    parts.push(section('Subscriptions found', subscriptionTable(a)));
  }

  if (state.debts.length) {
    parts.push(section('Debts',
      table({
        caption: 'Debt summary',
        headers: ['Debt', 'Balance', 'APR', 'Minimum / month'],
        numeric: [1, 2, 3],
        rows: [
          ...state.debts.map((d) => [d.name, formatMoney(d.balance), d.apr === null || d.apr === undefined ? 'not entered' : `${d.apr}%`, formatMoney(d.minPayment || 0)]),
          ['Total', formatMoney(state.debts.reduce((s, d) => s + d.balance, 0)), '', formatMoney(state.debts.reduce((s, d) => s + (d.minPayment || 0), 0))],
        ],
      }),
      debtComparison(state)));
  }

  if (state.budget) {
    const t = budgetTotals(state.budget, income.amount);
    parts.push(section('Budget',
      table({
        caption: `Monthly budget (${state.budget.method === '503020' ? 'started from a 50/30/20 split' : 'started from actual spending'})`,
        headers: ['Category', 'Budget / month'],
        numeric: [1],
        rows: [
          ...Object.entries(state.budget.lines).map(([c, v]) => [c, formatMoney(v)]),
          ['Savings & extra debt payments', formatMoney(t.savings)],
          ['Not yet assigned', formatMoney(t.unallocated, { sign: true })],
          ['Take-home income', formatMoney(income.amount)],
        ],
      })));
  }

  if (state.goals.length) parts.push(section('Savings goals', goalsTable(state).node));

  parts.push(el('footer', { class: 'report-footer' },
    el('p', {}, 'Not financial advice. This report gives general information based on the files provided and may contain errors, especially for data read from PDF statements.'),
    el('p', {}, state.settings.maskAccounts ? 'Account and card numbers are masked to their last 4 digits.' : 'Account numbers are shown in full.')));
  root.append(...parts);
}
