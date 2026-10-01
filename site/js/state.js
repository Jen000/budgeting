// The one and only place user data lives: a plain object in JavaScript memory.
// Nothing here is ever written to localStorage, sessionStorage, IndexedDB, cookies or caches.
import { defaultRuleList } from './categorize.js';

function freshState() {
  return {
    files: [],            // imported files: { id, name, format, accountLabel, isCreditCard, count, skipped, ... }
    transactions: [],     // normalized transactions (amount in cents, negative = money out)
    pendingCsv: null,     // CSV awaiting column mapping: { file, table }
    pendingPdf: null,     // PDF statement rows awaiting review
    pendingPaystub: null, // numbers read from a PDF paystub awaiting confirmation
    userRules: [],        // [{ pattern, category, source: 'user' }]
    defaultRules: defaultRuleList(),
    customCategories: [],
    paychecks: [],        // [{ id, label, gross, net, frequency, deductions: [{ name, amount }] }]
    debts: [],            // [{ id, name, balance, apr, minPayment, source }]
    debtSuggestions: [],  // balances found in statements, awaiting the user's confirmation
    extraDebtPayment: 0,
    budget: null,         // { method, lines: { [category]: cents }, savings: cents }
    goals: [],            // [{ id, name, target, saved, date }]
    settings: { maskAccounts: true },
    queue: [],            // File objects waiting while the user maps/reviews an earlier file
    drafts: { paycheck: null, debt: null, goal: null, rule: null },
    incomeOverride: null, // monthly take-home typed by the user on the Budget step
    ui: { step: 'upload', reviewFilter: '', reviewCategory: '', reviewShow: 'all', reviewPage: 0, makeRules: true },
  };
}

export const state = freshState();

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
let version = 0;
/** Bumped on every change; lets views cache derived data safely. */
export function dataVersion() { return version; }
export function notify(reason = 'update') { version++; for (const fn of listeners) fn(reason); }

/** Wipe every piece of user data from memory and return to step 1. */
export function clearAll() {
  const fresh = freshState();
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
  notify('clear');
}

export function hasData() {
  return state.files.length > 0 || state.transactions.length > 0 || state.paychecks.length > 0 ||
    state.debts.length > 0 || state.goals.length > 0 || state.pendingCsv !== null || state.pendingPdf !== null;
}
