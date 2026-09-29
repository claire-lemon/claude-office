import { escapeHtml } from '../lib/dom.js';
import { renderMarkdown } from '../lib/markdown.js';
import * as api from '../api.js';
import { view as appView, meeting as meetingStore, todos as todoStore } from '../store.js';
import { safeAnimal } from './sprites.js';
import { flashPanelError } from './toast.js';
import { refitOffice } from './layout.js';

// 회의실 (docs/specs/2026-09-29-meeting-room-design.md §6). Not a page of its own: body.screen-meeting
// (meeting.css) hides the desks and the board and sets the blackboard beside this panel. The server
// finds today's facilitator session; this view shows its last reply and starts / ends the meeting.

const HINT = '회의 시작을 누르고 앱에서 Enter를 누르면 진행자가 어제 기록을 정리해요.';
const NO_REPLY = '진행자가 아직 답하지 않았어요. 대화는 앱 채팅창에서 해요.';
// Bubble per facilitator status; anything else (stale, unknown) = away.
const BUBBLE = { working: '정리 중…', review: '답을 기다려요', question: '답을 기다려요', blocked: '답을 기다려요', hold: '보류', archived: '회의 끝', done: '회의 끝' };

// 진행자 | 📓 업무일지 (finishing-touches design §2.2). Not saved: a reload starts on 진행자.
const TABS = [['host', '진행자'], ['note', '📓 업무일지']];
// A poll already in flight when 업무일지 쓰기 answers still says running:false; that long after our
// own start, a running:false is not taken as "finished".
const SETTLE_MS = 1500;

// meeting: GET /api/meeting (or null before the first answer), todos: store.todos.
const view = { el: null, onChange: () => {}, meeting: null, todos: { list: [] } };
// busy: the action whose request is in flight (every button waits for it). tab: TABS id.
// watch: ms since a narration is watched to toast its end once (0 = none).
const ui = { busy: null, tab: 'host', watch: 0 };
const refs = {};
const painted = {}; // part -> last html; unchanged = DOM left alone (animations, scroll, selection)

const SHELL = `
  <div class="mt-head"><h2 class="mt-title">🏫 회의실</h2><span class="mt-sub hint"></span></div>
  <div class="mt-stage"></div>
  <div class="mt-tabs" role="tablist" aria-label="회의실 보기">${TABS.map(([id, label]) =>
    `<button type="button" role="tab" class="mt-tab" id="mt-tab-${id}" data-tab="${id}" aria-controls="mt-msg">${label}</button>`).join('')}</div>
  <div class="mt-msg" id="mt-msg" role="tabpanel"></div>
  <div class="mt-btns"></div>
  <p class="mt-board hint" hidden></p>
  <p class="mt-hint hint" hidden></p>
  <button type="button" class="mt-note" data-act="copy-note" title="클릭해서 경로 복사"></button>`;

// ---------- parts ----------
// none: no facilitator today, ended: the latest one was archived by 회의 끝.
const stageKey = m => (!m?.session ? 'none' : m.ended ? 'ended' : m.session.status);
const bubbleText = key => (key === 'none' ? '진행자 대기 중' : key === 'ended' ? '회의 끝' : BUBBLE[key] ?? '자리 비움');

// viewBox 96x78: the animal at 2x behind a meeting table; an empty dashed seat when nobody is there.
const TABLE = '<rect x="2" y="54" width="92" height="5" fill="var(--desk-edge)"/><rect x="2" y="59" width="92" height="19" fill="var(--desk)"/><rect x="62" y="51" width="18" height="3" fill="#fffaf2"/>';
const EMPTY_SEAT = '<rect x="34" y="16" width="28" height="36" rx="3" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/>';
const stageHtml = (m, key) => {
  const s = m?.session;
  const away = s && key !== 'ended' && !BUBBLE[key];
  const who = s
    ? `<g transform="translate(24,2) scale(2)"><g class="char-group${away ? ' grayscale' : ''}"><use href="#animal-${safeAnimal(s.animal)}" width="24" height="34"/></g></g>`
    : EMPTY_SEAT;
  return `<div class="mt-bubble">${escapeHtml(bubbleText(key))}</div>
    <svg viewBox="0 0 96 78" aria-hidden="true">${who}${TABLE}</svg>
    <div class="mt-name"${s ? ` title="${escapeHtml(s.title)}"` : ''}>${s ? '진행자' : '빈 자리'}</div>`;
};

const msgHtml = m => {
  const s = m?.session;
  if (s?.lastMessage) return `<div class="report-sec">${renderMarkdown(s.lastMessage)}</div>`;
  return `<p class="hint">${s && !m.ended ? NO_REPLY : HINT}</p>`;
};

// Button table (design §6.3.3). The last button is the main one.
const buttonsFor = m => {
  const s = m?.session;
  if (!s) return [['start', '회의 시작']];
  if (m.ended) return [['start', '회의 다시 시작']];
  return [...(s.link ? [['open', '채팅 열기']] : []), ['end', '회의 끝']];
};
const buttonsHtml = m => buttonsFor(m).map(([act, label], i, all) =>
  `<button type="button" class="mt-btn${i === all.length - 1 ? ' mt-primary' : ''}" data-act="${act}"${ui.busy ? ' disabled' : ''}>${escapeHtml(label)}</button>`).join('');

// 업무일지 tab (design §2.2.2): the note's AI narrative, then a status line (+ the error while failed).
const hhmm = ms => new Date(ms).toTimeString().slice(0, 5);
const narrStatus = n => {
  if (n.running) return `업무일지 쓰는 중…${n.startedAt ? ` (시작 ${hhmm(n.startedAt)})` : ''}`;
  if (n.exists) return n.writtenAt ? `${hhmm(n.writtenAt)} 작성` : '작성됨';
  return '오늘 업무일지가 아직 없어요 · 어제 세션을 AI가 1~2분에 걸쳐 정리해요';
};
const narrativeHtml = n => {
  if (!n) return '<p class="hint">불러오는 중…</p>';
  const body = n.text ? `<div class="report-sec">${renderMarkdown(n.text)}</div>` : '';
  const err = !n.running && n.error ? `<p class="mt-err" title="${escapeHtml(n.error)}">${escapeHtml(n.error)}</p>` : '';
  return `${body}<p class="hint mt-status">${escapeHtml(narrStatus(n))}</p>${err}`;
};
const narrateBtnHtml = n => (n
  ? `<button type="button" class="mt-btn mt-primary" data-act="narrate"${ui.busy || n.running ? ' disabled' : ''}>${n.exists ? '다시 쓰기' : '지금 쓰기'}</button>`
  : '');
// 진행자 tab, beside 회의 시작 (design §2.2.3): a nudge, never a gate.
const hintHtml = m => {
  const n = m?.narrative;
  if (!n || n.exists || n.running || buttonsFor(m).at(-1)[0] !== 'start') return '';
  return `업무일지를 먼저 쓰면 진행자가 어제 흐름까지 보고 정리해요 · <button type="button" class="mt-link" data-act="narrate"${ui.busy ? ' disabled' : ''}>업무일지 쓰기</button>`;
};

// 진행자 tab, under the buttons (meeting-board-sync design §2.6): what the server copied from the facilitator's
// `### 칠판` list, and the items it could not write.
const boardHtml = m => {
  const b = m?.board;
  const skipped = b?.skipped || [];
  return [
    b?.count > 0 ? `칠판에 반영: ${b.count}개` : '',
    skipped.length ? `<span class="mt-skip">폴더를 몰라 못 적은 항목: ${escapeHtml(skipped.map(s => s.title).join(', '))}</span>` : '',
  ].filter(Boolean).join(' · ');
};

// Display only: the home folder as ~ (the copy keeps the full path).
const tildePath = p => String(p).replace(/^\/(Users|home)\/[^/]+/, '~');
const noteHtml = m => (m?.note?.path
  ? `일지: <code>${escapeHtml(tildePath(m.note.path))}</code>${m.note.exists ? '' : ' (회의 시작 때 만들어요)'}`
  : '');

const subText = (m, todos) => {
  const scrum = (todos.list || []).filter(t => t.source === 'scrum').length;
  return [m?.date, m?.count ? `오늘 회의 ${m.count}번` : '', scrum ? `칠판에 🏫 ${scrum}개` : ''].filter(Boolean).join(' · ');
};

// Text the user is selecting in the message would be lost to a re-render.
const selecting = el => {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && el.contains(sel.anchorNode);
};

const paint = (part, html) => {
  if (painted[part] === html) return;
  if (part === 'msg' && selecting(refs.msg)) return;
  refs[part].innerHTML = html;
  painted[part] = html;
};

const draw = () => {
  const m = view.meeting;
  const key = stageKey(m);
  const onNote = ui.tab === 'note';
  refs.stage.dataset.status = key;
  refs.sub.textContent = subText(m, view.todos);
  refs.tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  refs.msg.setAttribute('aria-labelledby', `mt-tab-${ui.tab}`);
  paint('stage', stageHtml(m, key));
  paint('msg', onNote ? narrativeHtml(m?.narrative) : msgHtml(m));
  paint('btns', onNote ? narrateBtnHtml(m?.narrative) : buttonsHtml(m));
  paint('board', onNote ? '' : boardHtml(m));
  refs.board.hidden = !painted.board;
  paint('hint', onNote ? '' : hintHtml(m));
  refs.hint.hidden = !painted.hint;
  paint('note', noteHtml(m));
  refs.note.hidden = !m?.note?.path;
};

// ---------- actions ----------
const FAIL = { start: '회의를 열지 못했어요', open: '채팅방을 열지 못했어요', end: '회의를 끝내지 못했어요', 'copy-note': '복사하지 못했어요', narrate: '업무일지를 쓰지 못했어요' };
const ensureOk = async res => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error);
  return data;
};

// toast.js stampFx draws in #stamp-layer, which sits in the panel: while the panel is closed (its
// transform moves it off-screen) the stamp is invisible. Same look, on a viewport layer of its own.
const stamp = text => {
  const layer = Object.assign(document.createElement('div'), { className: 'stamp-layer' });
  const fx = Object.assign(document.createElement('div'), { className: 'stamp-fx', textContent: text });
  fx.addEventListener('animationend', () => layer.remove());
  layer.append(fx);
  document.body.append(layer);
};

const ACTIONS = {
  start: async () => {
    await ensureOk(await api.postMeetingStart());
    flashPanelError('진행자 입력창을 열었어요 · Enter만 누르세요', 6000);
  },
  open: async () => {
    const id = view.meeting?.session?.id;
    if (id) await ensureOk(await api.postOpen(id));
  },
  end: async () => {
    await ensureOk(await api.postMeetingEnd());
    stamp('끝');
    flashPanelError('회의 결과를 일지에 적었어요');
    setScreen('office');
  },
  'copy-note': async () => {
    const p = view.meeting?.note?.path;
    if (!p) return;
    await navigator.clipboard.writeText(p);
    flashPanelError('경로 복사됨');
  },
  // Runs in the server's background (1~2 min); shown as running now, the poll takes it from here.
  narrate: async () => {
    const data = await ensureOk(await api.postMeetingNarrate());
    ui.watch = Date.now();
    const n = view.meeting?.narrative;
    if (n && !n.running) view.meeting.narrative = { ...n, running: true, startedAt: Date.now(), error: null };
    flashPanelError(data.already ? '이미 쓰는 중이에요' : '업무일지를 쓰기 시작했어요 · 1~2분 걸려요', 4000);
  },
};

// One toast when a narration ends: one started here, or one a poll saw running (the 05시 timer).
// The tab is left as it is.
const watchNarration = n => {
  if (!n) return;
  if (n.running) { ui.watch ||= Date.now() - SETTLE_MS; return; }
  if (!ui.watch || Date.now() - ui.watch < SETTLE_MS) return;
  ui.watch = 0;
  flashPanelError(n.error ? '업무일지를 쓰지 못했어요' : '업무일지를 썼어요');
};

const run = async act => {
  if (ui.busy) return;
  ui.busy = act;
  draw();
  try { await ACTIONS[act](); } catch { flashPanelError(FAIL[act]); }
  ui.busy = null;
  draw();
  view.onChange();
};

const onClick = e => {
  const tab = e.target.closest('[role="tab"]');
  if (tab) {
    ui.tab = tab.dataset.tab;
    window.getSelection()?.removeAllRanges(); // paint keeps a selected message; a tab switch replaces it
    draw();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled || !Object.hasOwn(ACTIONS, btn.dataset.act)) return;
  run(btn.dataset.act);
};

// ---------- public ----------
// Once, at load. onChange: called after every action (main.js passes its poll).
export const mountMeeting = (el, { onChange = () => {} } = {}) => {
  if (!el) return;
  view.el = el;
  view.onChange = onChange;
  el.innerHTML = SHELL;
  refs.sub = el.querySelector('.mt-sub');
  refs.stage = el.querySelector('.mt-stage');
  refs.tabs = Array.from(el.querySelectorAll('[role="tab"]'));
  refs.msg = el.querySelector('.mt-msg');
  refs.btns = el.querySelector('.mt-btns');
  refs.board = el.querySelector('.mt-board');
  refs.hint = el.querySelector('.mt-hint');
  refs.note = el.querySelector('.mt-note');
  el.addEventListener('click', onClick);
  draw();
};

// meeting: GET /api/meeting body (null = not loaded yet), todos: store.todos.
export const renderMeeting = (meeting, todos) => {
  if (!view.el) return;
  view.meeting = meeting;
  view.todos = todos || { list: [] };
  watchNarration(meeting?.narrative);
  draw();
};

// The one place that switches screens: body class (meeting.css), the panel's hidden attr, the header
// button, and the URL hash (a reload with #meeting comes back here). replaceState: no history entry
// per toggle and no trailing '#'. The caller polls afterwards so the meeting data comes right away.
export const setScreen = screen => {
  const on = screen === 'meeting';
  appView.screen = on ? 'meeting' : 'office';
  document.body.classList.toggle('screen-meeting', on);
  if (view.el) view.el.hidden = !on;
  document.getElementById('meeting-open')?.setAttribute('aria-pressed', String(on));
  if (on !== (location.hash === '#meeting')) history.replaceState(null, '', on ? '#meeting' : location.pathname + location.search);
  if (on) renderMeeting(meetingStore.data, todoStore);
  refitOffice(); // the desks come back at a new size
};
