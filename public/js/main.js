import { $ } from './lib/dom.js';
import * as api from './api.js';
import { state, selected, controls, view, todos, meeting } from './store.js';
import * as office from './views/office.js';
import * as layout from './views/layout.js';
import * as board from './views/board.js';
import { mountBoardDnd } from './views/board-dnd.js';
import { filterById, mountFilters, updateCounters } from './views/filters.js';
import * as notify from './views/notify.js';
import { health, renderFreshness, renderNotices } from './views/freshness.js';
import * as archive from './views/archive.js';
import { mountBlackboard, renderBlackboard } from './views/blackboard.js';
import { mountMeeting, renderMeeting, setScreen } from './views/meeting.js';
import * as panel from './panel/panel.js';
import { handleAction } from './panel/footer.js';
import './views/sprites.js'; // side effect: populates #animal-defs once, before first render

const handleClick = e => {
  const door = e.target.closest('[data-screen]'); // 회의실 doors; focus follows to the door on the other side
  if (door) { setScreen(door.dataset.screen); document.querySelector(`[data-screen="${view.screen === 'meeting' ? 'office' : 'meeting'}"]`)?.focus(); poll(); return; }
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

// Esc: an open panel first, then the meeting screen (not while a dialog is open: Esc closes that one).
// Menus and inline edits stop their own Escape before it gets here.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (selected.id) { panel.closePanel(); return; }
  if (view.screen === 'meeting' && !document.querySelector('dialog[open]')) setScreen('office');
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
  office.updateDoor(list); // the full list: a filter doesn't end the meeting
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

// Todos ride the same poll. A failed /api/todos keeps the last lists (board/panel 📋 tags read them too).
const loadTodos = async () => {
  try {
    const res = await api.getTodos();
    if (!res.ok) return;
    const data = await res.json();
    todos.list = Array.isArray(data.todos) ? data.todos : [];
    todos.deleted = Array.isArray(data.deleted) ? data.deleted : [];
    todos.folders = Array.isArray(data.folders) ? data.folders : [];
  } catch {}
};

// Only on the meeting screen. A failed /api/meeting keeps the last answer.
const loadMeeting = async () => {
  if (view.screen !== 'meeting') return;
  try {
    const res = await api.getMeeting();
    if (res.ok) meeting.data = await res.json();
  } catch {}
};

// A failed /api/sessions keeps the last screen but flips the header badge to 오프라인.
const poll = async () => {
  const [res] = await Promise.all([api.getSessions().catch(() => null), loadTodos(), loadMeeting()]);
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
  renderBlackboard(todos, state.sessionsById); // after sessions: a linked worker is clickable only while on the board
  if (view.screen === 'meeting') renderMeeting(meeting.data, todos);
};
controls.poll = poll;
controls.selectSession = panel.selectSession;

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

mountBlackboard($('#blackboard'), { onChange: poll });
mountMeeting($('#meeting'), { onChange: poll });
layout.initLayout({ seats: office.SEATS });
const screenFromHash = () => setScreen(location.hash === '#meeting' ? 'meeting' : 'office');
screenFromHash(); // a reload on #meeting stays in the meeting room
window.addEventListener('hashchange', () => { screenFromHash(); poll(); }); // typed or linked #meeting
office.updateWindow();
poll();
setInterval(poll, 2000);
setInterval(renderFreshness, 1000);
setInterval(office.updateWindow, 30000);
