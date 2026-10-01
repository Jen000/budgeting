// Bootstraps the single-page app: step navigation, rendering, and the data-wiping lifecycle.
import { state, onChange, notify, clearAll, hasData } from './state.js';
import { $ } from './dom.js';
import { nav, setStatus } from './views/common.js';
import { renderUpload, handleFiles } from './views/upload.js';
import { renderReview } from './views/review.js';
import { renderInsights } from './views/insights.js';
import { renderBudget } from './views/budget.js';
import { renderGoals } from './views/goals.js';
import { renderReport } from './views/report.js';

const STEPS = ['upload', 'review', 'insights', 'budget', 'goals', 'export'];
const RENDER = { upload: renderUpload, review: renderReview, insights: renderInsights, budget: renderBudget, goals: renderGoals, export: renderReport };

function render() {
  // Re-rendering replaces nodes; keep keyboard focus on the "same" control by id.
  const active = document.activeElement;
  const activeId = active && active.id ? active.id : null;
  RENDER[state.ui.step]();
  if (activeId && document.activeElement !== active) {
    const again = document.getElementById(activeId);
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }
}

function showStep(step, { focus = true } = {}) {
  if (!STEPS.includes(step)) step = 'upload';
  state.ui.step = step;
  for (const section of document.querySelectorAll('[data-step-panel]')) section.hidden = section.dataset.stepPanel !== step;
  for (const btn of document.querySelectorAll('[data-step]')) {
    if (btn.dataset.step === step) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  }
  render();
  if (focus) $(`h-${step}`)?.focus();
}

function wipe(message) {
  clearAll();
  $('file-input').value = '';
  $('upload-errors').replaceChildren();
  $('mask-accounts').checked = true;
  showStep('upload', { focus: false });
  setStatus(message);
}

function init() {
  nav.go = showStep;
  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => showStep(btn.dataset.step));
  }
  onChange((reason) => { if (reason !== 'clear') render(); });

  $('clear-all').addEventListener('click', () => {
    if (hasData() && !window.confirm('Erase all files, transactions, budgets and goals from this page?')) return;
    wipe('All data was cleared from memory.');
    $('h-upload').focus();
  });

  $('file-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    handleFiles(files);
  });

  // Dropping a file anywhere else must never make the browser navigate to (open) it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  const zone = $('drop-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    handleFiles([...(e.dataTransfer?.files || [])]);
  });

  $('mask-accounts').addEventListener('change', (e) => { state.settings.maskAccounts = e.target.checked; notify(); });
  $('print-report').addEventListener('click', () => window.print());

  // The report lives in the Export step; make sure it is built and visible whenever printing.
  let restoreStep = null;
  window.addEventListener('beforeprint', () => {
    renderReport();
    const exportSection = $('step-export');
    if (exportSection.hidden) { restoreStep = state.ui.step; exportSection.hidden = false; }
  });
  window.addEventListener('afterprint', () => {
    if (restoreStep) { $('step-export').hidden = true; restoreStep = null; }
  });

  // Warn before leaving with data loaded (leaving erases it).
  window.addEventListener('beforeunload', (e) => { if (hasData()) { e.preventDefault(); e.returnValue = ''; } });
  // Wipe memory when the page is hidden for navigation, and never resume a page from the
  // back/forward cache with old data in it.
  window.addEventListener('pagehide', () => clearAll());
  window.addEventListener('pageshow', (e) => { if (e.persisted) wipe('This page was reopened, so all data was cleared.'); });

  showStep('upload', { focus: false });
}

init();
