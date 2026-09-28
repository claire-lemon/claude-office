import { $ } from './lib/dom.js';
import * as api from './api.js';
import { state, selected, controls } from './store.js';
import * as office from './views/office.js';
import * as layout from './views/layout.js';
import * as board from './views/board.js';
import * as notify from './views/notify.js';
import * as archive from './views/archive.js';
import * as panel from './panel/panel.js';
import { handleAction } from './panel/footer.js';
import './views/sprites.js'; // side effect: populates #animal-defs once, before first render

const handleClick = e => {
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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected.id) panel.closePanel();
});

// ---------- poll loop ----------
const applySessions = list => {
  state.sessionsById = new Map(list.map(s => [s.id, s]));
  office.renderOffice(list);
  board.renderKanban(list);
  board.updateCounters(list);
  panel.updatePanelOnPoll();
  notify.checkNotifications(list);
};

const poll = async () => {
  try {
    const res = await api.getSessions();
    if (!res.ok) return;
    const data = await res.json();
    applySessions(Array.isArray(data.sessions) ? data.sessions : []);
    openFromUrl();
  } catch {}
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
setInterval(office.updateWindow, 30000);
