// Step 3: where the money goes, and what looks like overspending.
import { state } from '../state.js';
import { $, el, clear, table, statusLabel } from '../dom.js';
import { overspendingFlags } from '../analysis.js';
import { barChart, columnChart } from '../charts.js';
import { formatMoney, formatMonth, formatDate, merchantLabel } from '../util.js';
import { getAnalysis, emptyState, nextButton } from './common.js';

export function flagText(f) {
  const m = (c) => formatMoney(c, { whole: true });
  switch (f.type) {
    case 'limit': return `${f.category} is over your ${m(f.limit)}/month limit: ${m(f.latest)} in ${formatMonth(f.month)}, ${m(f.avg)}/month on average.`;
    case 'growth': return f.previous
      ? `${f.category} grew ${f.pct}% from ${formatMonth(f.prevMonth)} (${m(f.previous)}) to ${formatMonth(f.month)} (${m(f.current)}).`
      : `${f.category}: ${m(f.current)} in ${formatMonth(f.month)}, up from nothing the month before.`;
    case 'subscriptions': return `${f.count} recurring subscription${f.count === 1 ? '' : 's'} found, costing about ${m(f.annual)} a year. Check that you still use each one.`;
    case 'deficit': return `You spent ${m(f.spend)} but received ${m(f.income)} over this period, which is ${m(f.spend - f.income)} more than came in.${f.months.length ? ` Months over: ${f.months.map(formatMonth).join(', ')}.` : ''}`;
    case 'deficit-months': return `Spending was higher than income in ${f.months.map(formatMonth).join(', ')}.`;
    default: return '';
  }
}

const SEVERITY_LABEL = { critical: 'Critical', serious: 'Over limit', warning: 'Watch', info: 'Note' };

export function flagList(flags) {
  if (!flags.length) return el('p', {}, statusLabel('good', 'No overspending flags. Set limits on the Budget step to get alerts per category.'));
  return el('ul', { class: 'flags' }, flags.map((f) => el('li', { class: `flag flag-${f.severity}` }, statusLabel(f.severity, SEVERITY_LABEL[f.severity] + ':'), ' ', flagText(f))));
}

export function categoryFigure(a) {
  return barChart({
    items: a.categories.filter((c) => c.total > 0).map((c) => ({ label: c.category, value: c.total })),
    format: (v) => formatMoney(v, { whole: true }),
    label: 'Bar chart of total spending by category. The same numbers are in the table below.',
  });
}

export function categoryTable(a) {
  return table({
    caption: 'Spending by category',
    headers: ['Category', 'Total', 'Per month', 'Share'],
    numeric: [1, 2, 3],
    rows: a.categories.map((c) => [c.category, formatMoney(c.total), formatMoney(c.monthly), a.totalSpend > 0 ? `${Math.round((c.total / a.totalSpend) * 100)}%` : '—']),
  });
}

export function monthFigure(a) {
  return columnChart({
    groups: a.byMonth.map((m) => ({ label: formatMonth(m.month).replace(' 20', " '"), values: { income: m.income, spend: m.spend } })),
    series: [{ key: 'income', name: 'Income', cls: 'series-income' }, { key: 'spend', name: 'Spending', cls: 'series-spend' }],
    format: (v) => formatMoney(v, { whole: true }),
    formatAxis: (v) => (v >= 100000 ? `$${Math.round(v / 100000)}k` : `$${Math.round(v / 100)}`),
    label: 'Column chart of income and spending per month. The same numbers are in the table below.',
  });
}

export function monthTable(a) {
  return table({
    caption: 'Income and spending by month',
    headers: ['Month', 'Income', 'Spending', 'Difference'],
    numeric: [1, 2, 3],
    rows: a.byMonth.map((m) => [formatMonth(m.month) + (a.complete.includes(m.month) ? '' : ' (partial)'), formatMoney(m.income), formatMoney(m.spend), formatMoney(m.income - m.spend, { sign: true })]),
  });
}

export function merchantTable(a, n = 15) {
  return table({
    caption: `Top ${Math.min(n, a.merchants.length)} merchants by spending`,
    headers: ['Merchant', 'Category', 'Transactions', 'Total'],
    numeric: [2, 3],
    rows: a.merchants.slice(0, n).map((m) => [merchantLabel(m.merchant), m.category, String(m.count), formatMoney(m.total)]),
  });
}

export function subscriptionTable(a) {
  if (!a.subscriptions.length) return el('p', { class: 'hint' }, 'No recurring subscriptions were detected.');
  return table({
    caption: 'Recurring subscriptions',
    headers: ['Merchant', 'Typical charge', 'How often', 'Per year', 'Last charged'],
    numeric: [1, 3],
    rows: a.subscriptions.map((s) => [merchantLabel(s.merchant), formatMoney(s.amount), s.cadence === 'unknown' ? 'seen once' : s.cadence, formatMoney(s.annual), formatDate(s.last)]),
  });
}

export function summaryTiles(a) {
  const net = a.totalIncome - a.totalSpend;
  const tile = (label, value, sub) => el('div', { class: 'tile' }, el('p', { class: 'tile-label' }, label), el('p', { class: 'tile-value' }, value), sub ? el('p', { class: 'tile-sub' }, sub) : null);
  return el('div', { class: 'tiles' },
    tile('Period', `${formatDate(a.from)} – ${formatDate(a.to)}`, `${a.months.length} month${a.months.length === 1 ? '' : 's'} of data`),
    tile('Income', formatMoney(a.totalIncome, { whole: true }), `${formatMoney(a.monthlyIncome, { whole: true })} per month`),
    tile('Spending', formatMoney(a.totalSpend, { whole: true }), `${formatMoney(a.monthlySpend, { whole: true })} per month`),
    tile(net >= 0 ? 'Left over' : 'Shortfall', formatMoney(Math.abs(net), { whole: true }), net >= 0 ? 'income minus spending' : 'spending above income'));
}

export function analysisNotices(a) {
  const notes = [];
  if (a.cardPayments > 0 && !a.hasCardFile) {
    notes.push(el('p', { class: 'notice notice-warning' }, `${formatMoney(a.cardPayments)} of credit-card payments are not counted as spending, because the purchases themselves are counted from the card's statement. Upload your card statements too, or that spending will be missing.`));
  }
  if (a.complete.length < a.months.length) {
    notes.push(el('p', { class: 'hint' }, 'The first or last month is only partly covered by your files, so monthly comparisons use complete months where possible.'));
  }
  return notes;
}

export function renderInsights() {
  const panel = clear($('insights-panel'));
  const a = getAnalysis(state);
  if (!a) { panel.append(emptyState('Nothing to analyze yet. Upload statements first.', '← Go to upload', 'upload')); return; }
  const flags = overspendingFlags(a, state.budget ? state.budget.lines : {});
  panel.append(
    summaryTiles(a),
    ...analysisNotices(a),
    el('h3', {}, 'Things to look at'),
    flagList(flags),
    el('h3', {}, 'Spending by category'),
    categoryFigure(a),
    categoryTable(a),
    el('h3', {}, 'Month by month'),
    monthFigure(a),
    monthTable(a),
    el('h3', {}, 'Top merchants'),
    barChart({ items: a.merchants.slice(0, 10).map((m) => ({ label: merchantLabel(m.merchant), value: m.total })), format: (v) => formatMoney(v, { whole: true }), label: 'Bar chart of the ten merchants you spent the most at. The same numbers are in the table below.' }),
    merchantTable(a),
    el('h3', {}, 'Subscriptions'),
    subscriptionTable(a),
    el('h3', {}, 'Income'),
    a.incomeSources.length ? table({ caption: 'Income found in your statements', headers: ['Type', 'Total'], numeric: [1], rows: a.incomeSources.map((s) => [s.category, formatMoney(s.total)]) }) : el('p', { class: 'hint' }, 'No income deposits were found. Add your paycheck on the Upload step.'),
    nextButton('Continue to budget →', 'budget'));
}
