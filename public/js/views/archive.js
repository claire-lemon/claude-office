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
  try { renderArchive((await api.getArchived().then(r => r.json())).archived || []); }
  catch { $('#archive-sessions').innerHTML = '<p class="hint">보관함을 불러오지 못했어요.</p>'; }
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
