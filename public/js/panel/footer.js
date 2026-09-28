import { $, escapeHtml } from '../lib/dom.js';
import * as api from '../api.js';
import { state, selected, summaryLoadingIds, activeTabState, controls } from '../store.js';
import { actionsFor } from './actions.js';
import { renderReportPane } from './report-tab.js';
import { flashPanelError, stampFx } from '../views/toast.js';

// ---------- menu state: one open menu ('split' | 'overflow') at a time ----------
// Kept in a single mutable const object (no let/var, per project style).
const menu = { openId: null, el: null, toggle: null };

const closeMenu = () => {
  if (!menu.openId) return;
  menu.el.classList.add('hidden');
  menu.toggle.setAttribute('aria-expanded', 'false');
  menu.openId = null; menu.el = null; menu.toggle = null;
};
// panel.js calls this when switching sessions / closing the panel, so a stale open menu from
// session A never survives into session B's freshly-rendered footer.
export const closeFooterMenus = closeMenu;

const menuItems = menuEl => Array.from(menuEl.querySelectorAll('.act-menu-item:not([disabled])'));

const openMenu = (toggleBtn, menuEl, id) => {
  closeMenu();
  menuEl.classList.remove('hidden');
  toggleBtn.setAttribute('aria-expanded', 'true');
  menu.openId = id; menu.el = menuEl; menu.toggle = toggleBtn;
  const first = menuItems(menuEl)[0];
  if (first) first.focus();
};

const moveMenuFocus = (menuEl, delta) => {
  const items = menuItems(menuEl);
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  items[(at + delta + items.length) % items.length].focus();
};

// Toggle open/closed on click.
document.addEventListener('click', e => {
  const toggle = e.target.closest('.act-menu-toggle');
  if (!toggle) return;
  const id = toggle.dataset.menu;
  const menuEl = toggle.parentElement.querySelector(`.act-menu[data-menu-for="${id}"]`);
  if (!menuEl) return;
  if (menu.openId === id) closeMenu();
  else openMenu(toggle, menuEl, id);
});
// Close on selecting an item, or clicking anywhere outside the open menu/its toggle.
document.addEventListener('click', e => {
  if (!menu.openId) return;
  if (e.target.closest('.act-menu-item')) { closeMenu(); return; }
  if (e.target.closest(`.act-menu[data-menu-for="${menu.openId}"]`)) return;
  if (e.target.closest(`.act-menu-toggle[data-menu="${menu.openId}"]`)) return;
  closeMenu();
});
// Esc closes the menu without also closing the whole panel (main.js has its own Escape handler
// for that, registered on document too; capture:true + stopImmediatePropagation runs first and
// suppresses it while a menu is open). Arrow keys move focus between menu items.
document.addEventListener('keydown', e => {
  if (!menu.openId) return;
  if (e.key === 'Escape') { closeMenu(); e.stopImmediatePropagation(); e.preventDefault(); return; }
  if (e.key === 'ArrowDown') { moveMenuFocus(menu.el, 1); e.preventDefault(); return; }
  if (e.key === 'ArrowUp') { moveMenuFocus(menu.el, -1); e.preventDefault(); return; }
}, true);

// ---------- render ----------
const overflowItemHtml = (item, loading) => {
  if (item.kind === 'separator') return '<hr class="act-menu-sep" role="separator">';
  const isSummary = item.id === 'summary';
  const label = isSummary && loading ? '생성 중... (최대 60초)' : item.label;
  const disabled = isSummary && loading ? ' disabled' : '';
  const danger = item.kind === 'danger' ? ' act-menu-danger' : '';
  return `<button type="button" class="act-btn act-menu-item${danger}" role="menuitem" data-action="${item.id}"${disabled}>${escapeHtml(label)}</button>`;
};

const splitOptionHtml = opt => `<button type="button" class="act-btn act-menu-item" role="menuitem" data-action="${opt.id}">${escapeHtml(opt.label)}</button>`;

const primaryHtml = primary => {
  if (!primary) return '';
  if (primary.kind !== 'split') return `<button type="button" class="act-btn act-primary" data-action="${primary.id}">${escapeHtml(primary.label)}</button>`;
  const options = (primary.options || []).map(splitOptionHtml).join('');
  return `
    <span class="act-split">
      <button type="button" class="act-btn act-primary" data-action="${primary.id}">${escapeHtml(primary.label)}</button>
      <button type="button" class="act-menu-toggle act-split-toggle" data-menu="split" aria-haspopup="menu" aria-expanded="false" title="다른 작업 선택">▾</button>
      <div class="act-menu hidden" role="menu" data-menu-for="split">${options}</div>
    </span>`;
};

export const renderPanelActions = session => {
  // A poll (or any other) re-render must not close an open menu or steal focus: just skip until
  // the user closes it (click/Esc/selection), which triggers the next render itself.
  if (menu.openId) return;
  const el = $('#panel-actions');
  const { primary, secondary, overflow } = actionsFor(session);
  const loading = summaryLoadingIds.has(session.id);
  const secondaryHtml = secondary ? `<button type="button" class="act-btn" data-action="${secondary.id}">${escapeHtml(secondary.label)}</button>` : '';
  const overflowHtml = `
    <span class="act-overflow">
      <button type="button" class="act-menu-toggle" data-menu="overflow" aria-haspopup="menu" aria-expanded="false" title="더보기">⋯</button>
      <div class="act-menu act-menu-right hidden" role="menu" data-menu-for="overflow">${overflow.map(item => overflowItemHtml(item, loading)).join('')}</div>
    </span>`;
  el.innerHTML = primaryHtml(primary) + secondaryHtml + overflowHtml;
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
const VERB_FN = { undo: api.postUndo, hold: api.postHold, archive: api.postArchive };
const postDecision = async (verb, id) => {
  try { const res = await VERB_FN[verb](id); if (res.ok) controls.poll(); return res.ok; } catch { return false; }
};

export const handleAction = action => {
  const id = selected.id;
  if (!id) return;
  const session = state.sessionsById.get(id);
  if (!session) return;
  if (action === 'open') api.postOpen(id).catch(() => {});
  else if (action === 'summary') runSummary(id);
  else if (action === 'confirm') runConfirm(id);
  else if (action === 'undo' || action === 'hold') postDecision(action, id);
  else if (action === 'archive') postDecision('archive', id).then(ok => { if (ok) { controls.closePanel(); flashPanelError('보관함으로 옮겼어요'); } });
  else if (action.startsWith('next:')) runNext(id, Number(action.slice(5)));
};
