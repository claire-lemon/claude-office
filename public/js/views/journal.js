import { $, escapeHtml } from '../lib/dom.js';
import { renderMarkdown } from '../lib/markdown.js';
import * as api from '../api.js';
import { flashPanelError } from './toast.js';

// 📓 업무일지 (header button → #journal-dialog): today's AI 서술 of yesterday's sessions, written by the server's
// 05시 timer or [지금 쓰기] (GET /api/journal, POST /api/narrate). Polled only while the dialog is open.
const POLL_MS = 2000;
// A poll already in flight when 지금 쓰기 answers still says running:false; that long after our own start,
// a running:false is not taken as "finished".
const SETTLE_MS = 1500;

// data: last GET /api/journal (null before the first). busy: POST in flight. watch: ms since a run is watched
// to toast its end once (0 = none). html: last markup, unchanged = DOM left alone (selection, scroll).
const ui = { data: null, busy: false, watch: 0, timer: 0, html: '' };
const dialog = $('#journal-dialog');
const body = $('#journal-body');

const hhmm = ms => new Date(ms).toTimeString().slice(0, 5);
const statusText = n => {
  if (n.running) return `쓰는 중…${n.startedAt ? ` (시작 ${hhmm(n.startedAt)})` : ''}`;
  if (n.exists) return n.writtenAt ? `${hhmm(n.writtenAt)} 작성` : '작성됨';
  return '오늘 업무일지가 아직 없어요 · 어제 세션을 AI가 1~2분에 걸쳐 정리해요';
};

const html = d => {
  if (!d) return '<p class="hint">불러오는 중…</p>';
  const n = d.narrative;
  const story = n.text ? `<div class="report-sec">${renderMarkdown(n.text)}</div>` : '';
  const err = !n.running && n.error ? `<p class="jr-err" title="${escapeHtml(n.error)}">${escapeHtml(n.error)}</p>` : '';
  const write = `<button type="button" class="jr-btn" data-act="narrate"${ui.busy || n.running ? ' disabled' : ''}>${n.exists ? '다시 쓰기' : '지금 쓰기'}</button>`;
  const note = `<button type="button" class="jr-note" data-act="copy" title="클릭해서 경로 복사">일지: <code>${escapeHtml(d.note.display || d.note.path)}</code></button>`;
  return `${story}<p class="hint jr-status">${escapeHtml(statusText(n))}</p>${err}<div class="jr-bar">${write}${note}</div>`;
};

// Text the user is selecting would be lost to a re-render.
const selecting = () => {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && body.contains(sel.anchorNode);
};
const draw = () => {
  const next = html(ui.data);
  if (next === ui.html || selecting()) return;
  body.innerHTML = next;
  ui.html = next;
};

// One toast when a run ends: one started here, or one a poll saw running (the 05시 timer).
const watch = n => {
  if (n.running) { ui.watch ||= Date.now() - SETTLE_MS; return; }
  if (!ui.watch || Date.now() - ui.watch < SETTLE_MS) return;
  ui.watch = 0;
  flashPanelError(n.error ? '업무일지를 쓰지 못했어요' : '업무일지를 썼어요');
};

// A failed GET keeps the last answer.
const load = async () => {
  try {
    const res = await api.getJournal();
    if (res.ok) ui.data = await res.json();
  } catch {}
  if (ui.data) watch(ui.data.narrative);
  draw();
};

// Runs in the server's background (1~2 min); shown as running now, the poll takes it from here.
const narrate = async () => {
  if (ui.busy) return;
  ui.busy = true;
  draw();
  try {
    const res = await api.postNarrate();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    ui.watch = Date.now();
    const n = ui.data?.narrative;
    if (n && !n.running) ui.data.narrative = { ...n, running: true, startedAt: Date.now(), error: null };
    flashPanelError(data.already ? '이미 쓰는 중이에요' : '업무일지를 쓰기 시작했어요 · 1~2분 걸려요', 4000);
  } catch {
    flashPanelError('업무일지를 쓰지 못했어요');
  }
  ui.busy = false;
  draw();
};

const copy = async () => {
  const p = ui.data?.note?.path;
  if (!p) return;
  try {
    await navigator.clipboard.writeText(p);
    flashPanelError('경로 복사됨');
  } catch {
    flashPanelError('복사하지 못했어요');
  }
};

const ACTIONS = { narrate, copy };
body.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (btn && !btn.disabled && Object.hasOwn(ACTIONS, btn.dataset.act)) ACTIONS[btn.dataset.act]();
});
dialog.addEventListener('close', () => clearInterval(ui.timer)); // ✕, backdrop or Esc

export const openJournal = () => {
  dialog.showModal();
  load();
  clearInterval(ui.timer);
  ui.timer = setInterval(load, POLL_MS);
};
export const closeJournal = () => dialog.close();
