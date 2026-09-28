import { $ } from '../lib/dom.js';
import * as api from '../api.js';
import { state, selected, summaryLoadingIds, activeTabState, controls } from '../store.js';
import { renderReportPane } from './report-tab.js';
import { flashPanelError, stampFx } from '../views/toast.js';

const actionBtn = (label, action, disabled) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'act-btn'; b.dataset.action = action; b.textContent = label;
  if (disabled) b.disabled = true;
  return b;
};
export const renderPanelActions = session => {
  const el = $('#panel-actions');
  el.innerHTML = '';
  if (session.link) el.appendChild(actionBtn('채팅방 열기','open'));
  if (session.prs && session.prs.length) el.appendChild(actionBtn('PR 열기','pr'));
  const loading = summaryLoadingIds.has(session.id);
  el.appendChild(actionBtn(loading ? '생성 중... (최대 60초)' : '요약 만들기', 'summary', loading));
  el.appendChild(actionBtn(session.status==='done' ? '컨펌 취소' : '컨펌 · 커밋·PR', session.status==='done' ? 'undo' : 'confirm'));
  el.appendChild(actionBtn(session.status==='hold' ? '보류 해제' : '보류', session.status==='hold' ? 'undo' : 'hold'));
  el.appendChild(actionBtn('아카이브', 'archive'));
  (session.nextTasks || []).slice(0, 3).forEach((t, i) => {
    const b = actionBtn(i === 0 ? 'OK · 1번 진행' : `${i + 1}번 진행`, `next:${i}`);
    b.title = t.title;
    if (i === 0) b.classList.add('act-primary');
    el.appendChild(b);
  });
};

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
  else if (action === 'pr') { const url = session.prs && session.prs[0] && session.prs[0].url; if (url) window.open(url, '_blank', 'noopener'); }
  else if (action === 'summary') runSummary(id);
  else if (action === 'confirm') runConfirm(id);
  else if (action === 'undo' || action === 'hold') postDecision(action, id);
  else if (action === 'archive') postDecision('archive', id).then(ok => { if (ok) { controls.closePanel(); flashPanelError('보관함으로 옮겼어요'); } });
  else if (action.startsWith('next:')) runNext(id, Number(action.slice(5)));
};
