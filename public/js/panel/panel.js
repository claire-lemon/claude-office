import { $ } from '../lib/dom.js';
import { safeAnimal, ANIMAL_LABELS } from '../views/sprites.js';
import { state, selected, activeTabState, controls } from '../store.js';
import { renderPanelActions } from './footer.js';
import { renderReportPane } from './report-tab.js';
import { setTab } from './changes-tab.js';

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

const renderPanelHeader = session => {
  $('#panel-animal').innerHTML = `<svg viewBox="0 0 24 34"><use href="#animal-${safeAnimal(session.animal)}"/></svg>`;
  $('#panel-name').textContent = session.title || '(제목 없음)';
  const prLabel = (session.prs && session.prs.length) ? prStateLabel(session.prs[0].state) : '-';
  $('#panel-sub').textContent = `${ANIMAL_LABELS[safeAnimal(session.animal)]} · ${session.branch || '-'} · PR ${prLabel} · ${session.turns ?? '-'}턴`;
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
const closePanel = () => { selected.id = null; $('#panel').classList.remove('open'); $('#panel').setAttribute('aria-hidden','true'); document.body.classList.remove('panel-open'); };
controls.closePanel = closePanel;
export { closePanel };

const renderPanelFull = () => {
  const session = state.sessionsById.get(selected.id);
  if (!session) { closePanel(); return; }
  renderPanelHeader(session);
  renderPanelActions(session);
  renderReportPane(session);
  setTab('report');
};

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
