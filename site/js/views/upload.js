// Step 1: files, column mapping, PDF row review, paychecks.
import { state, notify } from '../state.js';
import { $, el, clear, field, options, moneyInput, table, badge } from '../dom.js';
import { importFile, applyCsv, confirmPdf, removeFile, ImportError, isPdfAvailable } from '../files.js';
import { reconcile } from '../ledger.js';
import { FREQUENCIES, monthlyFromPaycheck } from '../budget.js';
import { formatMoney, parseMoneyInput, parseDate, newId, cleanText, LIMITS } from '../util.js';
import { setStatus, showErrors, accountText, nextButton } from './common.js';

let busy = false;

/** Import files one by one; pause the queue whenever a file needs the user's input. */
export async function handleFiles(files) {
  if (!files.length) return;
  state.queue.push(...files);
  if (busy || state.pendingCsv || state.pendingPdf || state.pendingPaystub) {
    setStatus(`${files.length} file(s) queued. Finish the current review first.`);
    notify();
    return;
  }
  await drainQueue();
}

async function drainQueue() {
  busy = true;
  const errors = [];
  const messages = [];
  try {
    while (state.queue.length) {
      const file = state.queue.shift();
      setStatus(`Reading ${cleanText(file.name, 80)}…`);
      try {
        const r = await importFile(state, file);
        messages.push(r.message);
        if (r.needs) break;
      } catch (err) {
        errors.push(err instanceof ImportError ? err.message : `${cleanText(file.name, 80)}: this file could not be read. ${err && err.message ? cleanText(err.message, 200) : ''}`);
      }
    }
  } finally {
    busy = false;
  }
  showErrors($('upload-errors'), errors);
  setStatus(messages.length ? messages.join(' ') : errors.length ? 'Some files could not be imported. See the messages below the upload area.' : '');
  notify();
}

function continueQueue() {
  if (state.queue.length) drainQueue();
  else notify();
}

export function renderUpload() {
  renderMapping();
  renderPdfReview();
  renderFiles();
  renderPaystub();
  renderPaycheckForm();
  renderPaychecks();
}

// ---------- CSV column mapping ----------

function renderMapping() {
  const panel = clear($('mapping-panel'));
  const p = state.pendingCsv;
  if (!p) return;
  const { record } = p;
  const t = record.table;
  const opts = record.options || {};
  const map = { ...(opts.map || t.map) };
  const cols = [{ value: '', label: '— not in this file —' }, ...t.headers.map((h, i) => ({ value: String(i), label: `${i + 1}: ${h}` }))];
  const sel = (role, label, required) => {
    const s = el('select', { id: `map-${role}`, on: { change: (e) => { if (e.target.value === '') delete map[role]; else map[role] = Number(e.target.value); } } },
      options(cols, map[role] === undefined ? '' : String(map[role])));
    return field(label + (required ? '' : ' (optional)'), s);
  };
  const dateOrder = el('select', { id: 'map-date-order' }, options([
    { value: 'MDY', label: 'Month first (01/31/2024)' }, { value: 'DMY', label: 'Day first (31/01/2024)' }], opts.dateOrder || t.dateOrder));
  const sign = el('select', { id: 'map-sign' }, options([
    { value: 'auto', label: 'Detect automatically' },
    { value: 'negOut', label: 'Negative numbers are money out (most bank accounts)' },
    { value: 'posOut', label: 'Positive numbers are money out (many credit cards)' }], opts.signConvention || 'auto'));
  const decimal = el('input', { type: 'checkbox', id: 'map-decimal', checked: opts.decimalComma ?? t.decimalComma });
  const errBox = el('div', { role: 'alert' });

  const preview = table({
    caption: 'First rows of the file (shown as plain text)',
    headers: t.headers,
    rows: t.rows.slice(0, 5).map((r) => t.headers.map((_, i) => cleanText(r[i] ?? '', 60))),
  });

  const importBtn = el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => {
    try {
      const msg = applyCsv(state, record, { map, dateOrder: dateOrder.value, signConvention: sign.value, decimalComma: decimal.checked });
      state.pendingCsv = null;
      setStatus(msg);
      continueQueue();
    } catch (err) {
      showErrors(errBox, [err instanceof ImportError ? err.message : 'These settings did not work for this file.']);
    }
  } } }, 'Import with these columns');
  const cancelBtn = el('button', { type: 'button', class: 'btn', on: { click: () => { state.pendingCsv = null; setStatus('Column mapping cancelled.'); continueQueue(); } } }, p.remap ? 'Cancel' : 'Skip this file');

  panel.append(el('div', { class: 'card card-attention', role: 'group', 'aria-labelledby': 'map-title' },
    el('h3', { id: 'map-title' }, `Choose columns for “${record.name}”`),
    p.remap ? null : el('p', {}, 'The column names in this file were not recognized. Tell us which column holds what.'),
    preview,
    el('div', { class: 'grid-3' },
      sel('date', 'Date', true), sel('description', 'Description', true), sel('amount', 'Amount (one column, signed)', false),
      sel('debit', 'Money out column', false), sel('credit', 'Money in column', false), sel('type', 'Debit/credit type column', false)),
    el('p', { class: 'hint' }, 'You need a Date, a Description, and either an Amount column or Money out / Money in columns.'),
    el('div', { class: 'grid-3' }, field('Date format', dateOrder), field('Amount signs', sign),
      el('div', { class: 'field-row' }, decimal, el('label', { for: 'map-decimal' }, 'Amounts use a decimal comma (1.234,56)'))),
    errBox,
    el('div', { class: 'btn-row' }, importBtn, cancelBtn)));
}

// ---------- PDF statement review ----------

function renderPdfReview() {
  const panel = clear($('pdf-review-panel'));
  const p = state.pendingPdf;
  if (!p) return;
  const errBox = el('div', { role: 'alert' });
  const included = p.rows.filter((r) => r.include).length;
  const rows = p.rows.slice(0, 1000).map((r, i) => {
    const out = r.amount < 0;
    return el('tr', {},
      el('td', {}, el('input', { type: 'checkbox', id: `pdf-inc-${r.id}`, checked: r.include, 'aria-label': `Include row ${i + 1}`, on: { change: (e) => { r.include = e.target.checked; notify(); } } })),
      el('td', {}, el('input', { type: 'date', id: `pdf-date-${r.id}`, value: r.date, 'aria-label': `Date, row ${i + 1}`, on: { change: (e) => { r.date = parseDate(e.target.value) || r.date; } } })),
      el('td', {}, el('input', { type: 'text', id: `pdf-desc-${r.id}`, value: r.description, autocomplete: 'off', 'aria-label': `Description, row ${i + 1}`, on: { change: (e) => { r.description = cleanText(e.target.value) || r.description; } } })),
      el('td', { class: 'num' }, moneyInput(`pdf-amt-${r.id}`, Math.abs(r.amount), (v) => { const c = parseMoneyInput(v); if (c) r.amount = (r.amount < 0 ? -1 : 1) * Math.abs(c); notify(); }, { 'aria-label': `Amount, row ${i + 1}` })),
      el('td', {}, el('select', { id: `pdf-dir-${r.id}`, 'aria-label': `Money in or out, row ${i + 1}`, on: { change: (e) => { r.amount = (e.target.value === 'out' ? -1 : 1) * Math.abs(r.amount); notify(); } } },
        options([{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }], out ? 'out' : 'in'))));
  });
  panel.append(el('div', { class: 'card card-attention', role: 'group', 'aria-labelledby': 'pdf-title' },
    el('h3', { id: 'pdf-title' }, `Review rows read from “${p.record.name}”`),
    el('p', { class: 'notice notice-warning' }, 'PDF reading is best-effort. Check each date, amount and direction, and untick anything that is not a transaction (totals, balances, headings). A CSV or OFX export is more reliable.'),
    el('div', { class: 'field-row' },
      el('input', { type: 'checkbox', id: 'pdf-card', checked: p.record.isCreditCard, on: { change: (e) => { p.record.isCreditCard = e.target.checked; } } }),
      el('label', { for: 'pdf-card' }, 'This is a credit-card statement')),
    p.rows.length > 1000 ? el('p', { class: 'hint' }, `Showing the first 1,000 of ${p.rows.length} rows.`) : null,
    el('div', { class: 'table-wrap' }, el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, ['Use', 'Date', 'Description', 'Amount', 'Direction'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows))),
    errBox,
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => {
        try { setStatus(confirmPdf(state)); continueQueue(); } catch (err) { showErrors(errBox, [err.message]); }
      } } }, `Import ${included} selected rows`),
      el('button', { type: 'button', class: 'btn', on: { click: () => { state.pendingPdf = null; setStatus('PDF import cancelled.'); continueQueue(); } } }, 'Discard this PDF'))));
}

// ---------- imported files ----------

function renderFiles() {
  const panel = clear($('files-panel'));
  if (!state.files.length) {
    panel.append(el('p', { class: 'hint' }, `No files yet. Limits: ${LIMITS.maxFileBytes / 1048576} MB and ${LIMITS.maxRowsPerFile.toLocaleString()} rows per file.` +
      (isPdfAvailable() ? '' : ' PDF support is unavailable in this build.')));
    return;
  }
  const rows = state.files.map((f) => {
    const txs = state.transactions.filter((t) => t.fileId === f.id);
    const dups = txs.filter((t) => t.autoExclude === 'duplicate').length;
    const signSel = f.format === 'CSV' ? el('select', { id: `sign-${f.id}`, 'aria-label': `Amount signs for ${f.name}`, on: { change: (e) => {
      try { setStatus(applyCsv(state, f, { signConvention: e.target.value })); } catch (err) { setStatus(err.message); }
      notify();
    } } }, options([{ value: 'negOut', label: 'Negative = money out' }, { value: 'posOut', label: 'Positive = money out' }], f.options?.signConvention)) : null;
    return el('tr', {},
      el('th', { scope: 'row' }, f.name, el('br'), el('span', { class: 'hint' }, f.format)),
      el('td', {}, accountText(state, f.accountLabel) || '—'),
      el('td', { class: 'num' }, String(f.count), dups ? el('div', { class: 'hint' }, `${dups} duplicates`) : null),
      el('td', {}, f.skipped.length
        ? el('details', {}, el('summary', {}, `${f.skipped.length} skipped`), el('ul', { class: 'small' }, f.skipped.slice(0, 20).map((s) => el('li', {}, `Row ${s.row}: ${s.reason}`))))
        : '0'),
      el('td', {},
        el('div', { class: 'field-row' },
          el('input', { type: 'checkbox', id: `cc-${f.id}`, checked: f.isCreditCard, on: { change: (e) => { f.isCreditCard = e.target.checked; reconcile(state); notify(); } } }),
          el('label', { for: `cc-${f.id}` }, 'Credit card')),
        signSel),
      el('td', {}, el('div', { class: 'btn-col' },
        f.format === 'CSV' ? el('button', { type: 'button', class: 'btn btn-small', on: { click: () => { state.pendingCsv = { record: f, remap: true }; notify(); $('map-title')?.scrollIntoView(); } } }, 'Change columns') : null,
        el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', 'aria-label': `Remove ${f.name}`, on: { click: () => { removeFile(state, f.id); setStatus(`${f.name} removed.`); notify(); } } }, 'Remove'))));
  });
  const total = state.transactions.length;
  panel.append(el('h3', {}, 'Loaded files'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ['File', 'Account', 'Transactions', 'Skipped rows', 'Options', ''].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows))),
    el('p', { class: 'hint' }, `${total.toLocaleString()} transactions in memory.`),
    total ? nextButton('Continue to review →', 'review') : null);
}

// ---------- paychecks ----------

function blankPaycheck() { return { label: 'Main job', gross: null, net: null, frequency: 'biweekly', deductions: [] }; }

function paycheckForm(draft, idPrefix, onSave, onCancel, title) {
  const errBox = el('div', { role: 'alert' });
  const dedRows = draft.deductions.map((d, i) => el('div', { class: 'grid-3 deduction' },
    field('Deduction', el('input', { id: `${idPrefix}-dn-${i}`, type: 'text', autocomplete: 'off', value: d.name, on: { change: (e) => { d.name = cleanText(e.target.value, 60); } } })),
    field('Amount per paycheck', moneyInput(`${idPrefix}-da-${i}`, d.amount, (v) => { d.amount = parseMoneyInput(v); })),
    el('div', { class: 'field' }, el('button', { type: 'button', class: 'btn btn-small', on: { click: () => { draft.deductions.splice(i, 1); notify(); } } }, 'Remove deduction'))));
  const form = el('form', { class: 'card', autocomplete: 'off', 'aria-label': title, novalidate: true, on: { submit: (e) => {
    e.preventDefault();
    if (!draft.net || draft.net <= 0) { showErrors(errBox, ['Enter your net (take-home) pay per paycheck.']); return; }
    if (draft.gross && draft.gross < draft.net) { showErrors(errBox, ['Gross pay should be at least the net pay.']); return; }
    onSave();
  } } },
    el('h4', {}, title),
    el('div', { class: 'grid-3' },
      field('Name', el('input', { id: `${idPrefix}-label`, type: 'text', autocomplete: 'off', value: draft.label, on: { change: (e) => { draft.label = cleanText(e.target.value, 60); } } })),
      field('Gross pay per paycheck', moneyInput(`${idPrefix}-gross`, draft.gross, (v) => { draft.gross = parseMoneyInput(v); }), 'Before taxes and deductions'),
      field('Net (take-home) pay per paycheck', moneyInput(`${idPrefix}-net`, draft.net, (v) => { draft.net = parseMoneyInput(v); }, { required: true }), 'What lands in your account'),
      field('How often you are paid', el('select', { id: `${idPrefix}-freq`, on: { change: (e) => { draft.frequency = e.target.value; } } },
        options(Object.entries(FREQUENCIES).map(([value, f]) => ({ value, label: f.label })), draft.frequency)))),
    dedRows,
    el('button', { type: 'button', class: 'btn btn-small', on: { click: () => { draft.deductions.push({ name: '', amount: null }); notify(); } } }, '+ Add a deduction'),
    errBox,
    el('div', { class: 'btn-row' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save paycheck'),
      onCancel ? el('button', { type: 'button', class: 'btn', on: { click: onCancel } }, 'Discard') : null));
  return form;
}

function renderPaystub() {
  const panel = clear($('paystub-panel'));
  const p = state.pendingPaystub;
  if (!p) return;
  if (!p.label) p.label = 'Paystub';
  panel.append(el('p', { class: 'notice notice-warning' }, `Numbers read from “${p.source}”. Please check every value before saving.`),
    paycheckForm(p, 'stub', () => {
      state.paychecks.push({ id: newId('pay'), label: p.label || 'Paystub', gross: p.gross, net: p.net, frequency: p.frequency, deductions: p.deductions.filter((d) => d.name && d.amount) });
      state.pendingPaystub = null;
      setStatus('Paycheck saved.');
      continueQueue();
    }, () => { state.pendingPaystub = null; setStatus('Paystub discarded.'); continueQueue(); }, 'Confirm paystub'));
}

function renderPaycheckForm() {
  const panel = clear($('paycheck-form-panel'));
  if (!state.drafts.paycheck) state.drafts.paycheck = blankPaycheck();
  const d = state.drafts.paycheck;
  panel.append(paycheckForm(d, 'pc', () => {
    state.paychecks.push({ id: newId('pay'), ...d, deductions: d.deductions.filter((x) => x.name && x.amount) });
    state.drafts.paycheck = blankPaycheck();
    setStatus('Paycheck saved.');
    notify();
  }, null, 'Add a paycheck'));
}

function renderPaychecks() {
  const panel = clear($('paychecks-panel'));
  if (!state.paychecks.length) return;
  panel.append(table({
    caption: 'Your paychecks',
    headers: ['Name', 'Gross / paycheck', 'Net / paycheck', 'Frequency', 'Deductions', 'Net per month', ''],
    numeric: [1, 2, 5],
    rows: state.paychecks.map((p) => [
      p.label || 'Paycheck', formatMoney(p.gross), formatMoney(p.net), FREQUENCIES[p.frequency]?.label || p.frequency,
      p.deductions.length ? p.deductions.map((d) => `${d.name} ${formatMoney(d.amount)}`).join('; ') : '—',
      formatMoney(monthlyFromPaycheck(p)),
      el('button', { type: 'button', class: 'btn btn-small btn-danger-outline', 'aria-label': `Remove paycheck ${p.label}`, on: { click: () => { state.paychecks = state.paychecks.filter((x) => x !== p); notify(); } } }, 'Remove'),
    ]),
  }), el('p', { class: 'hint' }, `Total take-home per month: ${formatMoney(state.paychecks.reduce((s, p) => s + monthlyFromPaycheck(p), 0))}. `,
    badge('Used for budgeting instead of deposits', 'info')));
}
