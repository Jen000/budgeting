// Step 2: review every transaction, re-categorize, include/exclude, manage rules.
import { state, notify } from '../state.js';
import { $, el, clear, field, options, badge, idSafe } from '../dom.js';
import { reconcile, isExcluded, classify } from '../ledger.js';
import { suggestPattern } from '../categorize.js';
import { formatMoney, formatDate, cleanText, merchantLabel, LIMITS } from '../util.js';
import { setStatus, allCategories, accountText, descText, emptyState, nextButton } from './common.js';

const PAGE = 100;

const SHOW = [
  { value: 'all', label: 'All transactions' },
  { value: 'counted', label: 'Counted (spending & income)' },
  { value: 'uncategorized', label: 'Uncategorized (“Other”)' },
  { value: 'excluded', label: 'Excluded / duplicates' },
  { value: 'transfers', label: 'Transfers & card payments' },
  { value: 'refunds', label: 'Refunds' },
];

function matchesFilter(t) {
  const ui = state.ui;
  if (ui.reviewCategory && t.category !== ui.reviewCategory) return false;
  if (ui.reviewFilter) {
    const q = ui.reviewFilter.toLowerCase();
    if (!t.description.toLowerCase().includes(q) && !t.merchant.toLowerCase().includes(q)) return false;
  }
  const c = classify(t, state.customCategories);
  switch (ui.reviewShow) {
    case 'counted': return c === 'spend' || c === 'income';
    case 'uncategorized': return t.category === 'Other' || t.category === 'Other income';
    case 'excluded': return c === 'excluded';
    case 'transfers': return c === 'neutral';
    case 'refunds': return c === 'spend' && t.amount > 0;
    default: return true;
  }
}

function setCategory(t, category) {
  t.category = category;
  t.categorySource = 'user';
  t.refund = false;
  let msg = `Changed to ${category}.`;
  if (state.ui.makeRules && t.merchant && t.merchant !== 'UNKNOWN') {
    const pattern = suggestPattern(t.merchant);
    if (pattern.length >= 3 && state.userRules.length < LIMITS.maxRules) {
      state.userRules = state.userRules.filter((r) => r.pattern !== pattern);
      state.userRules.push({ pattern, category, source: 'user' });
      // Apply to every other transaction from this merchant that the user hasn't set by hand.
      const same = state.transactions.filter((x) => x !== t && x.merchant === t.merchant && x.categorySource !== 'user');
      msg = `Changed to ${category}, plus a rule “${pattern}” → ${category}${same.length ? ` (also applied to ${same.length} other transaction${same.length === 1 ? '' : 's'})` : ''}.`;
    }
  }
  reconcile(state);
  setStatus(msg);
  notify();
}

export function renderReview() {
  renderTable();
  renderRules();
}

function renderTable() {
  const panel = clear($('review-panel'));
  if (!state.transactions.length) {
    panel.append(emptyState('No transactions yet. Upload a statement first.', '← Go to upload', 'upload'));
    return;
  }
  const ui = state.ui;
  const all = state.transactions;
  const counts = {
    dup: all.filter((t) => t.autoExclude === 'duplicate' && isExcluded(t)).length,
    neutral: all.filter((t) => classify(t, state.customCategories) === 'neutral').length,
    excluded: all.filter((t) => isExcluded(t)).length,
    other: all.filter((t) => t.category === 'Other').length,
  };
  const list = all.filter(matchesFilter).sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
  const pages = Math.max(Math.ceil(list.length / PAGE), 1);
  if (ui.reviewPage >= pages) ui.reviewPage = pages - 1;
  const pageRows = list.slice(ui.reviewPage * PAGE, ui.reviewPage * PAGE + PAGE);
  const cats = allCategories(state);

  const summary = el('ul', { class: 'chips' },
    el('li', {}, `${all.length.toLocaleString()} transactions`),
    el('li', {}, `${counts.dup} duplicates removed`),
    el('li', {}, `${counts.neutral} transfers & card payments not counted`),
    el('li', {}, `${counts.other} in “Other”`));

  const search = el('input', { id: 'rv-search', type: 'search', autocomplete: 'off', value: ui.reviewFilter, on: { change: (e) => { ui.reviewFilter = cleanText(e.target.value, 80); ui.reviewPage = 0; notify(); } } });
  const catSel = el('select', { id: 'rv-cat', on: { change: (e) => { ui.reviewCategory = e.target.value; ui.reviewPage = 0; notify(); } } },
    options([{ value: '', label: 'All categories' }, ...cats], ui.reviewCategory));
  const showSel = el('select', { id: 'rv-show', on: { change: (e) => { ui.reviewShow = e.target.value; ui.reviewPage = 0; notify(); } } }, options(SHOW, ui.reviewShow));
  const makeRules = el('input', { type: 'checkbox', id: 'rv-makerules', checked: ui.makeRules, on: { change: (e) => { ui.makeRules = e.target.checked; } } });

  const rows = pageRows.map((t) => {
    const c = classify(t, state.customCategories);
    const notes = [];
    if (t.autoExclude === 'duplicate') notes.push(badge('Duplicate', 'muted'));
    if (c === 'neutral') notes.push(badge(t.category === 'Credit card payment' ? 'Card payment' : 'Transfer', 'muted'));
    if (t.pairId) notes.push(badge('Matched pair', 'muted'));
    if (c === 'spend' && t.amount > 0) notes.push(badge('Refund', 'good'));
    if (t.userInclude === false) notes.push(badge('Excluded by you', 'muted'));
    const sel = el('select', { id: `cat-${t.id}`, 'aria-label': `Category for ${t.description.slice(0, 60)}`, on: { change: (e) => setCategory(t, e.target.value) } }, options(cats, t.category));
    const inc = el('input', { type: 'checkbox', id: `inc-${t.id}`, checked: !isExcluded(t), 'aria-label': `Count this transaction: ${t.description.slice(0, 60)}`,
      on: { change: (e) => { t.userInclude = e.target.checked; reconcile(state); notify(); } } });
    return el('tr', { class: isExcluded(t) ? 'row-excluded' : (c === 'neutral' ? 'row-neutral' : null) },
      el('td', { class: 'nowrap' }, formatDate(t.date)),
      el('th', { scope: 'row', class: 'desc' }, descText(state, t.description), el('div', { class: 'hint' }, merchantLabel(t.merchant), t.account ? ` · ${accountText(state, t.account)}` : '')),
      el('td', { class: ['num', t.amount > 0 ? 'pos' : null] }, formatMoney(t.amount, { sign: true })),
      el('td', {}, sel),
      el('td', { class: 'center' }, inc),
      el('td', {}, notes));
  });

  const pager = pages > 1 ? el('nav', { class: 'pager', 'aria-label': 'Transaction pages' },
    el('button', { type: 'button', class: 'btn btn-small', id: 'rv-prev', disabled: ui.reviewPage === 0, on: { click: () => { ui.reviewPage--; notify(); } } }, '← Previous'),
    el('span', {}, `Page ${ui.reviewPage + 1} of ${pages} (${list.length.toLocaleString()} shown)`),
    el('button', { type: 'button', class: 'btn btn-small', id: 'rv-next', disabled: ui.reviewPage >= pages - 1, on: { click: () => { ui.reviewPage++; notify(); } } }, 'Next →')) : null;

  panel.append(summary,
    el('div', { class: 'grid-3 filters' }, field('Search descriptions', search), field('Category', catSel), field('Show', showSel)),
    el('div', { class: 'field-row' }, makeRules, el('label', { for: 'rv-makerules' }, 'When I change a category, also create a rule for that merchant')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data review' },
      el('caption', {}, 'Transactions (money out is negative)'),
      el('thead', {}, el('tr', {}, ['Date', 'Description', 'Amount', 'Category', 'Count it', 'Notes'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: '6' }, 'Nothing matches these filters.'))))),
    pager,
    nextButton('Continue to insights →', 'insights'));
}

function renderRules() {
  const panel = clear($('rules-panel'));
  const cats = allCategories(state);
  if (!state.drafts.rule) state.drafts.rule = { pattern: '', category: 'Groceries' };
  const d = state.drafts.rule;
  const errBox = el('div', { role: 'alert' });
  const addRule = el('form', { class: 'card', autocomplete: 'off', 'aria-label': 'Add a rule', novalidate: true, on: { submit: (e) => {
    e.preventDefault();
    const pattern = cleanText(d.pattern, 60).toLowerCase();
    if (pattern.length < 2) { errBox.replaceChildren(el('p', { class: 'notice notice-critical' }, 'Type at least 2 characters to match.')); return; }
    state.userRules = state.userRules.filter((r) => r.pattern !== pattern);
    state.userRules.push({ pattern, category: d.category, source: 'user' });
    // Rules re-categorize everything except transactions the user set by hand.
    state.drafts.rule = { pattern: '', category: d.category };
    reconcile(state);
    setStatus(`Rule added: “${pattern}” → ${d.category}.`);
    notify();
  } } },
    el('div', { class: 'grid-3' },
      field('When the description contains', el('input', { id: 'rule-pattern', type: 'text', autocomplete: 'off', value: d.pattern, on: { change: (e) => { d.pattern = e.target.value; } } }), 'Plain text, not case-sensitive'),
      field('Use category', el('select', { id: 'rule-cat', on: { change: (e) => { d.category = e.target.value; } } }, options(cats.filter((c) => c !== 'Other'), d.category))),
      el('div', { class: 'field field-end' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add rule'))),
    errBox);

  const newCat = el('form', { class: 'inline-form', autocomplete: 'off', 'aria-label': 'Add a custom category', on: { submit: (e) => {
    e.preventDefault();
    const input = $('new-cat');
    const name = cleanText(input.value, 40);
    if (!name || cats.includes(name)) { setStatus(name ? `“${name}” already exists.` : 'Type a category name.'); return; }
    state.customCategories.push(name);
    setStatus(`Category “${name}” added. It counts as spending.`);
    notify();
  } } }, field('New spending category', el('input', { id: 'new-cat', type: 'text', autocomplete: 'off' })), el('button', { type: 'submit', class: 'btn' }, 'Add category'));

  const list = state.userRules.length
    ? el('ul', { class: 'rule-list' }, state.userRules.map((r) => el('li', {},
      el('span', {}, `“${r.pattern}” → ${r.category}`),
      el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', id: `rule-del-${idSafe(r.pattern)}`, 'aria-label': `Delete rule ${r.pattern}`, on: { click: () => {
        state.userRules = state.userRules.filter((x) => x !== r);
        reconcile(state);
        notify();
      } } }, 'Delete'))))
    : el('p', { class: 'hint' }, 'No rules of your own yet. Changing a category above can create one for you.');
  panel.append(list, addRule, newCat,
    el('details', {}, el('summary', {}, `Built-in rules (${state.defaultRules.length})`),
      el('p', { class: 'hint' }, 'Built-in keywords are matched at the start of a word, and the longest match wins.'),
      el('ul', { class: 'small columns' }, groupDefaults().map(([cat, pats]) => el('li', {}, el('strong', {}, cat + ': '), pats.join(', '))))));
}

function groupDefaults() {
  const m = new Map();
  for (const r of state.defaultRules) { if (!m.has(r.category)) m.set(r.category, []); m.get(r.category).push(r.pattern.trim()); }
  return [...m.entries()];
}
