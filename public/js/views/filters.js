import { escapeHtml } from '../lib/dom.js';
import { view } from '../store.js';

// Header counter filters (docs/specs/2026-09-28-board-interactions-design.md §5.4). One row per
// filter; the first row is the "no filter" default. columns?: board columns left visible (omit to
// keep every column and filter cards only, e.g. a project filter). Counts use the same match.
export const FILTERS = [
  { id: 'all', label: '출근', match: () => true },
  { id: 'pending', label: '결재 대기', match: s => s.column === 'pending', columns: ['pending'] },
  { id: 'hold', label: '보류', match: s => s.column === 'hold', columns: ['hold'] },
];
export const filterById = id => FILTERS.find(f => f.id === id) ?? FILTERS[0];

// cnt-checkin predates the filter ids; base.css colors the numbers by these ids.
const counterId = f => (f.id === 'all' ? 'cnt-checkin' : `cnt-${f.id}`);
const buttons = { els: [] };

// Only a real filter shows as pressed: with 'all' the header looks exactly like before.
const markActive = () => buttons.els.forEach(b => {
  b.setAttribute('aria-pressed', String(b.dataset.filter === view.filter && b.dataset.filter !== FILTERS[0].id));
});

// Builds the counter buttons into el. Not a toggle: pressing the active filter again does nothing,
// 출근 clears it. onChange re-renders from the last session list.
export const mountFilters = (el, onChange) => {
  el.innerHTML = FILTERS.map(f => `<button type="button" class="counter" id="${counterId(f)}" data-filter="${f.id}"><span class="num">0</span><span class="label">${escapeHtml(f.label)}</span></button>`).join('');
  buttons.els = Array.from(el.querySelectorAll('.counter'));
  el.addEventListener('click', e => {
    const btn = e.target.closest('.counter');
    if (!btn || btn.dataset.filter === view.filter) return;
    view.filter = btn.dataset.filter;
    markActive();
    onChange();
  });
  markActive();
};

// Counts come from the full list, whatever filter is active.
export const updateCounters = list => buttons.els.forEach(b => {
  b.querySelector('.num').textContent = String(list.filter(filterById(b.dataset.filter).match).length);
});

// Tab title and alerts (views/notify.js) count exactly what the 결재 대기 counter counts, blocked included.
// fresh = pending ids that were not pending on the previous poll; prevIds null (first poll) = none fresh,
// so opening the page never rings.
export const pendingAlert = (list, prevIds) => {
  const ids = list.filter(filterById('pending').match).map(s => s.id);
  const fresh = prevIds ? ids.filter(id => !prevIds.includes(id)) : [];
  return { count: ids.length, ids, fresh };
};
