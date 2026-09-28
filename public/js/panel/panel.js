import { $ } from '../lib/dom.js';
import { inlineEdit } from '../lib/inline-edit.js';
import * as api from '../api.js';
import { safeAnimal, ANIMAL_LABELS } from '../views/sprites.js';
import { state, selected, activeTabState, controls, todos } from '../store.js';
import { renderPanelActions, closeFooterMenus } from './footer.js';
import { renderReportPane } from './report-tab.js';
import { setTab } from './changes-tab.js';
import { mountResize } from './resize.js';
import { flashPanelError } from '../views/toast.js';

export { setTab } from './changes-tab.js';

const prStateLabel = st => ({ OPEN:'열림', MERGED:'머지됨', CLOSED:'닫힘' }[st] || st || '-');

// Same shape as views/board.js's diffStatHtml, duplicated here: views/ and panel/ don't import
// each other (only store/api/lib), so this tiny pure helper is kept local to each side instead.
const diffStatHtml = session => {
  const ds = session.diffStat;
  if (!ds) return '';
  const files = Number(ds.files) || 0;
  const add = Number(ds.add) || 0;
  const del = Number(ds.del) || 0;
  const warn = (session.status === 'review' && files === 0) ? ' <span class="tag-warn">변경 없음</span>' : '';
  return `<span class="ds-add">+${add}</span> <span class="ds-del">−${del}</span> · ${files}개 파일${warn}`;
};

// Same lookup as views/board.js (views/ and panel/ don't import each other).
const todoTitle = id => todos.list.find(t => t.id === id)?.title ?? '할 일';

// Name: shown as text, click/Enter/F2 turns it into an input (§5.5). Every 2s poll re-renders
// the header, so the name is left alone while an edit is open.
const nameEl = $('#panel-name');
nameEl.setAttribute('role', 'button');
nameEl.tabIndex = 0;

const renderPanelName = session => {
  if (nameEl.dataset.editing) return;
  nameEl.textContent = session.title || '(제목 없음)';
  nameEl.title = session.appTitle && session.appTitle !== session.title ? `앱 이름: ${session.appTitle}` : '클릭해서 이름 바꾸기';
};

const renderPanelHeader = session => {
  $('#panel-animal').innerHTML = `<svg viewBox="0 0 24 34"><use href="#animal-${safeAnimal(session.animal)}"/></svg>`;
  renderPanelName(session);
  const prLabel = (session.prs && session.prs.length) ? prStateLabel(session.prs[0].state) : '-';
  const sub = $('#panel-sub');
  sub.textContent = `${ANIMAL_LABELS[safeAnimal(session.animal)]} · ${session.branch || '-'} · PR ${prLabel} · ${session.turns ?? '-'}턴`;
  if (session.todoId) sub.append(' · ', Object.assign(document.createElement('span'), { className: 'todo-tag', textContent: `📋 ${todoTitle(session.todoId)}` }));
  const loc = $('#panel-loc');
  loc.replaceChildren(...[
    ['📁 프로젝트', session.projectPath],
    ['🌿 브랜치', session.branch ? `${session.branch}${session.sourceBranch ? ` ← ${session.sourceBranch}` : ''}` : '브랜치 없음'],
    ['📍 세션 위치', session.cwd],
  ].map(([k, v]) => {
    const row = document.createElement('div');
    const key = document.createElement('span'); key.className = 'loc-k'; key.textContent = k;
    const val = document.createElement('code'); val.textContent = v || '-';
    row.append(key, val);
    return row;
  }));
  const dsEl = $('#panel-diffstat');
  const dsHtml = diffStatHtml(session);
  dsEl.innerHTML = dsHtml;
  dsEl.classList.toggle('hidden', !dsHtml);
};

const openPanel = () => { $('#panel').classList.add('open'); $('#panel').setAttribute('aria-hidden','false'); document.body.classList.add('panel-open'); };
const closePanel = () => { closeFooterMenus(); selected.id = null; $('#panel').classList.remove('open'); $('#panel').setAttribute('aria-hidden','true'); document.body.classList.remove('panel-open'); };
controls.closePanel = closePanel;
export { closePanel };

const renderPanelFull = () => {
  const session = state.sessionsById.get(selected.id);
  if (!session) { closePanel(); return; }
  closeFooterMenus(); // switching sessions must not leave the previous session's menu open
  renderPanelHeader(session);
  renderPanelActions(session);
  renderReportPane(session);
  setTab('report');
};

// Optimistic: show the new name now, then adopt the server's answer (empty = app name) and poll
// so the desk nameplate and kanban card follow. A poll landing mid-save can briefly show the
// old name; the post-save poll fixes it.
const setTitle = (id, patch) => {
  const session = state.sessionsById.get(id);
  if (!session) return;
  Object.assign(session, patch);
  if (selected.id === id) renderPanelHeader(session);
};

const saveTitle = async (id, prevTitle, title) => {
  const session = state.sessionsById.get(id);
  if (!session) return;
  setTitle(id, { title: title || session.appTitle || prevTitle });
  try {
    const res = await api.postEdit(id, { title });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error);
    setTitle(id, { title: data.title, appTitle: data.appTitle });
    controls.poll();
  } catch {
    setTitle(id, { title: prevTitle });
    flashPanelError('이름을 저장하지 못했어요');
  }
};

const startRename = () => {
  const id = selected.id;
  const session = state.sessionsById.get(id);
  if (!session) return;
  inlineEdit(nameEl, {
    value: session.title || '',
    maxLength: 80,
    placeholder: session.appTitle || '',
    onCommit: title => saveTitle(id, session.title, title),
  });
};
nameEl.addEventListener('click', startRename);
nameEl.addEventListener('keydown', e => {
  // target check: keys typed inside the edit input bubble up here too.
  if (e.target !== nameEl || (e.key !== 'Enter' && e.key !== 'F2')) return;
  e.preventDefault();
  startRename();
});

export const updatePanelOnPoll = () => {
  if (!selected.id) return;
  const session = state.sessionsById.get(selected.id);
  if (!session) return;
  renderPanelHeader(session);
  renderPanelActions(session);
  if (activeTabState.tab === 'report') renderReportPane(session);
};

export const selectSession = id => {
  if (selected.id === id) { closePanel(); return; }
  selected.id = id;
  openPanel();
  renderPanelFull();
};

mountResize($('#panel'), {}); // once, at module load
