// Small helpers shared by the step views.
import { $, el } from '../dom.js';
import { dataVersion } from '../state.js';
import { analyze } from '../analysis.js';
import { monthlyIncome } from '../budget.js';
import { categoryNames } from '../categorize.js';
import { maskAccount, maskDigits } from '../util.js';

/** Navigation hook, set by main.js (avoids a circular import). */
export const nav = { go: () => {} };

export function setStatus(text) { $('status').textContent = text; }

export function showErrors(container, messages) {
  container.replaceChildren(...messages.map((m) => el('p', { class: 'notice notice-critical' }, m)));
}

/** Analysis is recomputed only when state has changed since the last call. */
let cache = { version: -1, value: null };
export function getAnalysis(state) {
  const v = dataVersion();
  if (cache.version !== v) cache = { version: v, value: analyze(state) };
  return cache.value;
}

export function incomeForBudget(state, analysis) {
  if (state.incomeOverride !== null) return { amount: state.incomeOverride, source: 'override' };
  return monthlyIncome(state, analysis);
}

export function allCategories(state) {
  return [...categoryNames(), ...state.customCategories];
}

export function accountText(state, raw, forReport = false) {
  if (!raw) return '';
  if (forReport && !state.settings.maskAccounts) return raw;
  return maskAccount(raw);
}

export function descText(state, raw, forReport = false) {
  if (forReport && !state.settings.maskAccounts) return raw;
  return maskDigits(raw);
}

export function emptyState(text, actionLabel, step) {
  return el('div', { class: 'empty' }, el('p', {}, text),
    actionLabel ? el('button', { type: 'button', class: 'btn', on: { click: () => nav.go(step) } }, actionLabel) : null);
}

export function nextButton(label, step) {
  return el('div', { class: 'next-row' }, el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => nav.go(step) } }, label));
}
