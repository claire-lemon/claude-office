import { $, escapeHtml } from '../lib/dom.js';
import { inlineMd } from '../lib/markdown.js';
import * as api from '../api.js';
import { state, selected, controls } from '../store.js';
import { flashPanelError } from './toast.js';

// ---------- 보관함 ----------
const fmtDate = ms => ms ? new Date(ms).toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-';
export const renderArchive = list => {
  $('#archive-sessions').innerHTML = list.length
    ? `<table class="archive-table"><thead><tr><th>작업 이름</th><th>날짜</th><th>작업 한 줄 요약</th><th></th></tr></thead><tbody>${list.map(a => `<tr><td>${escapeHtml(a.title)}</td><td class="at">${escapeHtml(fmtDate(a.lastAt || a.archivedAt))}</td><td class="sum">${inlineMd(a.summary || '-')}</td><td><button type="button" class="act-btn restore-btn" data-id="${escapeHtml(a.id)}">복구</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">보관한 작업이 없어요.</p>';
};
export const loadArchive = async () => {
  loadTodoHistory(); // its own table: one failing doesn't blank the other
  try { renderArchive((await api.getArchived().then(r => r.json())).archived || []); }
  catch { $('#archive-sessions').innerHTML = '<p class="hint">보관함을 불러오지 못했어요.</p>'; }
};

// 지난 할 일 (docs/specs/2026-09-29-todo-history-design.md §3.6): todos off today's board. Read-only, no restore.
const mmdd = ms => { const d = new Date(ms); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const todoResult = t => (t.deletedAt ? `삭제 ${mmdd(t.deletedAt)}` : t.doneAt ? `완료 ${mmdd(t.doneAt)}` : '-');
const sessionTrail = t => (t.sessions || []).map(s => s.title).reverse().join(' → ') || '-'; // server: recent first
const renderTodoHistory = list => {
  $('#archive-todos').innerHTML = list.length
    ? `<table class="archive-table"><thead><tr><th>할 일</th><th>프로젝트</th><th>결과</th><th>세션</th></tr></thead><tbody>${list.map(t => `<tr><td>${escapeHtml(t.title)}</td><td title="${escapeHtml(t.folder)}">${escapeHtml(t.project || '-')}</td><td class="at">${escapeHtml(todoResult(t))}</td><td class="sum">${escapeHtml(sessionTrail(t))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">지난 할 일이 없어요.</p>';
};
const loadTodoHistory = async () => {
  try {
    const res = await api.getTodoHistory();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderTodoHistory((await res.json()).todos || []);
  } catch { $('#archive-todos').innerHTML = '<p class="hint">지난 할 일을 불러오지 못했어요.</p>'; }
};
export const archiveAllDone = async () => {
  const ids = [...state.sessionsById.values()].filter(s => s.status === 'done').map(s => s.id);
  const results = await Promise.all(ids.map(id => api.postArchive(id).then(r => r.ok).catch(() => false)));
  if (ids.includes(selected.id)) controls.closePanel();
  controls.poll();
  flashPanelError(`완료 ${results.filter(Boolean).length}건을 보관함으로 옮겼어요`);
};
export const openArchive = () => { $('#archive-dialog').showModal(); loadArchive(); };
export const restoreArchived = async id => {
  try {
    const res = await api.postRestore(id);
    if (res.ok) { controls.poll(); flashPanelError('보류 칸으로 복구했어요'); loadArchive(); }
  } catch {}
};
