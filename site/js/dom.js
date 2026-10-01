// Safe DOM construction. This is the only way the app builds UI:
// createElement / createElementNS + textContent. No innerHTML, outerHTML,
// insertAdjacentHTML or document.write anywhere (and Trusted Types in the CSP
// makes the browser reject them even if someone added one by mistake).

const FORBIDDEN = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'href', 'src', 'action', 'formaction', 'style']);
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (FORBIDDEN.has(key) || (key !== 'on' && /^on/i.test(key))) throw new Error(`dom: attribute "${key}" is not allowed`);
    if (key === 'class') node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'for') node.htmlFor = value;
    else if (key === 'value') node.value = String(value);
    else if (key === 'checked') node.checked = !!value;
    else if (key === 'selected') node.selected = !!value;
    else if (key === 'disabled') node.disabled = !!value;
    else if (key === 'hidden') node.hidden = !!value;
    else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    else if (key === 'dataset') for (const [k, v] of Object.entries(value)) node.dataset[k] = String(v);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** el('p', { class: 'x' }, 'text', otherNode) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function clear(node) { node.replaceChildren(); return node; }

export function $(id) { return document.getElementById(id); }

/** Make a string safe for use inside an element id. */
export function idSafe(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '_'); }

export function table({ caption, headers, rows, className = 'data', numeric = [] }) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: className },
      caption ? el('caption', {}, caption) : null,
      el('thead', {}, el('tr', {}, headers.map((h, i) => el('th', { scope: 'col', class: numeric.includes(i) ? 'num' : null }, h)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => (i === 0 ? el('th', { scope: 'row', class: numeric.includes(i) ? 'num' : null }, c) : el('td', { class: numeric.includes(i) ? 'num' : null }, c))))))));
}

export function options(list, selected) {
  return list.map((o) => {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    return el('option', { value, selected: value === selected }, label);
  });
}

/** Labeled input with a stable id. */
export function field(label, input, hint) {
  const hintId = hint ? input.id + '-hint' : null;
  if (hintId) input.setAttribute('aria-describedby', hintId);
  return el('div', { class: 'field' }, el('label', { for: input.id }, label), input, hint ? el('p', { class: 'hint', id: hintId }, hint) : null);
}

export function moneyInput(id, cents, onChange, extra = {}) {
  return el('input', {
    id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    value: cents === null || cents === undefined ? '' : (cents / 100).toFixed(2),
    on: { change: (e) => onChange(e.target.value) },
    ...extra,
  });
}

export function badge(text, kind = '') { return el('span', { class: ['badge', kind && `badge-${kind}`] }, text); }

const ICONS = { critical: '⛔', serious: '▲', warning: '◆', info: 'ℹ', good: '✓' };
export function statusLabel(severity, text) {
  return el('span', { class: `status status-${severity}` }, el('span', { class: 'status-icon', 'aria-hidden': 'true' }, ICONS[severity] || '•'), ' ', text);
}
