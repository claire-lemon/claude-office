import { $, escapeHtml } from '../lib/dom.js';
import * as api from '../api.js';
import { state, selected, summaryLoadingIds, activeTabState, controls } from '../store.js';
import { actionsFor } from './actions.js';
import { renderReportPane } from './report-tab.js';
import { flashPanelError, stampFx } from '../views/toast.js';

// ---------- split menu state (the ▾ next to "OK · 1번 진행": 2번·3번 진행) ----------
// Kept in a single mutable const object (no let/var, per project style). el set = menu open.
const menu = { el: null, toggle: null };

const closeMenu = () => {
  if (!menu.el) return;
  menu.el.classList.add('hidden');
  menu.toggle.setAttribute('aria-expanded', 'false');
  menu.el = null; menu.toggle = null;
};
// panel.js calls this when switching sessions / closing the panel, so a stale open menu from
// session A never survives into session B's freshly-rendered footer.
export const closeFooterMenus = closeMenu;

const menuItems = () => Array.from(menu.el.querySelectorAll('.act-menu-item'));

const openMenu = toggle => {
  menu.el = toggle.parentElement.querySelector('.act-menu');
  menu.toggle = toggle;
  menu.el.classList.remove('hidden');
  toggle.setAttribute('aria-expanded', 'true');
  menuItems()[0]?.focus();
};

const moveMenuFocus = delta => {
  const items = menuItems();
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  items[(at + delta + items.length) % items.length].focus();
};

// Toggle on ▾; close on selecting an item or clicking anywhere outside the menu. Registered
// before main.js's click handler (module order), so the menu is closed before the action runs.
document.addEventListener('click', e => {
  const toggle = e.target.closest('.act-split-toggle');
  if (toggle) { if (menu.el) closeMenu(); else openMenu(toggle); return; }
  if (menu.el && (e.target.closest('.act-menu-item') || !e.target.closest('.act-menu'))) closeMenu();
});
// Esc closes the menu without also closing the whole panel (main.js has its own Escape handler
// for that, registered on document too; capture:true + stopImmediatePropagation runs first and
// suppresses it while a menu is open). Arrow keys move focus between menu items.
document.addEventListener('keydown', e => {
  if (!menu.el) return;
  if (e.key === 'Escape') { closeMenu(); e.stopImmediatePropagation(); e.preventDefault(); return; }
  if (e.key === 'ArrowDown') { moveMenuFocus(1); e.preventDefault(); return; }
  if (e.key === 'ArrowUp') { moveMenuFocus(-1); e.preventDefault(); return; }
}, true);

// ---------- render: row 1 = primary + secondary, row 2 = small extra buttons ----------
const buttonHtml = (item, cls, loading) => {
  const busy = item.id === 'summary' && loading;
  const label = busy ? '생성 중... (최대 60초)' : item.label;
  const title = item.hint ? ` title="${escapeHtml(item.hint)}"` : '';
  return `<button type="button" class="act-btn${cls}" data-action="${item.id}"${title}${busy ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
};

const splitOptionHtml = opt => `<button type="button" class="act-btn act-menu-item" role="menuitem" data-action="${opt.id}" title="${escapeHtml(opt.hint || '')}">${escapeHtml(opt.label)}</button>`;

const primaryHtml = primary => {
  if (!primary) return '';
  if (primary.kind !== 'split') return buttonHtml(primary, ' act-primary', false);
  const options = (primary.options || []).map(splitOptionHtml).join('');
  return `
    <span class="act-split">
      ${buttonHtml(primary, ' act-primary', false)}
      <button type="button" class="act-split-toggle" aria-haspopup="menu" aria-expanded="false" title="다른 작업 선택">▾</button>
      <div class="act-menu hidden" role="menu">${options}</div>
    </span>`;
};

const extraHtml = (item, loading) => buttonHtml(item, item.kind === 'danger' ? ' act-sm act-danger' : ' act-sm', loading);

export const renderPanelActions = session => {
  // A poll (or any other) re-render must not close an open menu or steal focus: just skip until
  // the user closes it (click/Esc/selection), which triggers the next render itself.
  if (menu.el) return;
  const { primary, secondary, extra } = actionsFor(session);
  const loading = summaryLoadingIds.has(session.id);
  const row1 = primaryHtml(primary) + (secondary ? buttonHtml(secondary, '', loading) : '');
  const row2 = extra.map(item => extraHtml(item, loading)).join('');
  $('#panel-actions').innerHTML = (row1 ? `<div class="act-row">${row1}</div>` : '')
    + (row2 ? `<div class="act-row act-row-extra">${row2}</div>` : '');
};

// ---------- action handlers (unchanged behavior) ----------
const fetchSummary = async id => {
  try {
    const res = await api.postSummary(id);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.summary) return false;
    const session = state.sessionsById.get(id);
    if (session) session.summary = data.summary;
    return true;
  } catch {
    return false;
  }
};
const runSummary = async id => {
  summaryLoadingIds.add(id);
  if (selected.id === id) renderPanelActions(state.sessionsById.get(id));
  const ok = await fetchSummary(id);
  summaryLoadingIds.delete(id);
  if (selected.id === id) {
    const session = state.sessionsById.get(id);
    if (session) {
      renderPanelActions(session);
      if (activeTabState.tab === 'report') renderReportPane(session);
    }
    if (!ok) flashPanelError('요약 생성 실패');
  }
};
const runConfirm = async id => {
  try {
    const res = await api.postConfirm(id);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      stampFx('쾅');
      controls.poll();
      flashPanelError(data.opened ? '지시문 복사됨 · 채팅방에서 ⌘V → Enter' : '지시문 복사됨 · 세션에 ⌘V → Enter', 6000);
    }
  } catch {}
};
const runNext = async (id, index) => {
  try {
    const res = await api.postNext(id, index);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { flashPanelError(data.error === 'repo folder not found' ? '레포 폴더를 찾지 못했어요' : '다음 작업을 열지 못했어요'); return; }
    stampFx('출발');
    controls.poll();
    flashPanelError('새 세션 입력창을 열었어요 · Enter만 누르세요', 6000);
  } catch {}
};
const postDecision = async (post, id) => {
  try { const res = await post(id); if (res.ok) controls.poll(); return res.ok; } catch { return false; }
};
const runArchive = async id => {
  if (!(await postDecision(api.postArchive, id))) return;
  controls.closePanel();
  flashPanelError('보관함으로 옮겼어요');
};

// One row per button id in actions.js. `next:N` (split primary/options, report-tab ▶ 진행) is
// the only prefixed action and is handled separately below.
const ACTION_HANDLERS = {
  open: id => api.postOpen(id).catch(() => {}),
  summary: runSummary,
  confirm: runConfirm,
  undo: id => postDecision(api.postUndo, id),
  hold: id => postDecision(api.postHold, id),
  archive: runArchive,
};

export const handleAction = action => {
  const id = selected.id;
  if (!id || !state.sessionsById.has(id)) return;
  if (String(action).startsWith('next:')) { runNext(id, Number(action.slice(5))); return; }
  if (Object.hasOwn(ACTION_HANDLERS, action)) ACTION_HANDLERS[action](id);
};
