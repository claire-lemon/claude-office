import { $ } from './lib/dom.js';
import * as api from './api.js';
import { state, selected, controls, view } from './store.js';
import * as office from './views/office.js';
import * as layout from './views/layout.js';
import * as board from './views/board.js';
import { mountBoardDnd } from './views/board-dnd.js';
import { filterById, mountFilters, updateCounters } from './views/filters.js';
import * as notify from './views/notify.js';
import { health, renderFreshness, renderNotices } from './views/freshness.js';
import * as archive from './views/archive.js';
import * as journal from './views/journal.js';
import * as panel from './panel/panel.js';
import { handleAction } from './panel/footer.js';
import './views/sprites.js'; // side effect: populates #animal-defs once, before first render

const handleClick = e => {
  if (e.target.closest('#journal-open')) { journal.openJournal(); return; }
  if (e.target.closest('#journal-close') || e.target.id === 'journal-dialog') { journal.closeJournal(); return; } // ✕ or backdrop
  if (e.target.closest('#archive-open')) { archive.openArchive(); return; }
  if (e.target.closest('#archive-done')) { archive.archiveAllDone(); return; }
  if (e.target.closest('#archive-close')) { $('#archive-dialog').close(); return; }
  if (e.target.id === 'archive-dialog') { $('#archive-dialog').close(); return; } // backdrop click
  const restoreBtn = e.target.closest('.restore-btn');
  if (restoreBtn) { archive.restoreArchived(restoreBtn.dataset.id); return; }
  const deskEl = e.target.closest('.desk.occupied');
  if (deskEl) { panel.selectSession(deskEl.dataset.id); return; }
  const cardEl = e.target.closest('.kan-card');
  if (cardEl) { panel.selectSession(cardEl.dataset.id); return; }
  const tabBtn = e.target.closest('.tab-btn');
  if (tabBtn) { panel.setTab(tabBtn.dataset.tab); return; }
  const actBtn = e.target.closest('.act-btn');
  if (actBtn && !actBtn.disabled) { handleAction(actBtn.dataset.action); return; }
  if (e.target.closest('#panel-close')) { panel.closePanel(); return; }
  if (e.target.closest('#panel-backdrop')) { panel.closePanel(); return; }
};
document.addEventListener('click', handleClick);

// Esc closes an open panel (a dialog closes itself). Menus and inline edits stop their own Escape first.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected.id) panel.closePanel();
});

// ---------- render (poll, filter change, drag end) ----------
// From the last polled list (sessionsById keeps its order). The filter narrows the office and the
// board; counters always count the full list and the open panel is left alone.
const render = () => {
  const list = [...state.sessionsById.values()];
  const f = filterById(view.filter);
  if (f.id === 'all') office.renderOffice(list);
  else office.renderOffice(list.filter(f.match), { showEmpty: false });
  board.renderKanban(list, f);
  updateCounters(list);
};
mountFilters($('.counters'), render);
mountBoardDnd($('.kan-columns'), { onEnd: render });

// ---------- poll loop ----------
const applySessions = list => {
  state.sessionsById = new Map(list.map(s => [s.id, s]));
  render();
  panel.updatePanelOnPoll();
  notify.checkNotifications(list);
};

// A failed /api/sessions keeps the last screen but flips the header badge to 오프라인.
const poll = async () => {
  const res = await api.getSessions().catch(() => null);
  try {
    if (!res || !res.ok) throw new Error('poll failed');
    const data = await res.json();
    const list = Array.isArray(data.sessions) ? data.sessions : [];
    Object.assign(health, { okAt: Date.now(), failed: false, hooksInstalled: data.hooksInstalled !== false, sessions: list.length });
    applySessions(list);
    openFromUrl();
  } catch {
    health.failed = true;
  }
  renderFreshness();
  renderNotices();
};
controls.poll = poll;

// ?open=<session id>&tab=diff opens that session's panel once (bookmarks, README screenshots).
const urlOpen = { done: false };
const openFromUrl = () => {
  if (urlOpen.done) return;
  urlOpen.done = true;
  const params = new URLSearchParams(location.search);
  const id = params.get('open');
  if (!id || !state.sessionsById.has(id)) return;
  panel.selectSession(id);
  if (params.get('tab') === 'diff') panel.setTab('diff');
};

layout.initLayout({ seats: office.SEATS });
office.updateWindow();
poll();
setInterval(poll, 2000);
setInterval(renderFreshness, 1000);
setInterval(office.updateWindow, 30000);
