import { $, $$, escapeHtml } from '../lib/dom.js';
import * as api from '../api.js';
import { selected, diffCache, activeTabState } from '../store.js';

const patchLines = patch => String(patch||'').split('\n').map(l => {
  const cls = l.startsWith('+++')||l.startsWith('---') ? 'meta' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
  return `<span class="${cls}">${escapeHtml(l)}</span>`;
}).join('\n');

export const renderDiffPane = () => {
  const pane = $('#pane-diff');
  const entry = diffCache.get(selected.id);
  if (!entry || entry.loading) { pane.innerHTML = '<p class="hint">변경사항을 불러오는 중...</p>'; return; }
  if (entry.tracked === false) { pane.innerHTML = '<p class="hint">변경 추적 불가</p>'; return; }
  if (entry.error) { pane.innerHTML = `<p class="hint">오류: ${escapeHtml(entry.error)}</p>`; return; }
  const statLine = entry.stat ? `<p class="diff-stat">${escapeHtml(entry.stat)}</p>` : '<p class="diff-stat">변경 없음</p>';
  const filesHtml = (entry.files||[]).map((f, i) => `<details class="diff-file"${i === 0 ? ' open' : ''}><summary>${escapeHtml(f.path)}</summary><pre class="patch">${patchLines(f.patch)}</pre></details>`).join('');
  const untrackedHtml = (entry.untracked||[]).length
    ? `<div class="untracked"><h5>추적되지 않는 파일</h5><ul>${entry.untracked.map(u=>`<li>${escapeHtml(u)}</li>`).join('')}</ul></div>` : '';
  const truncNote = entry.truncated ? '<p class="hint">내용이 커서 일부만 표시했어요.</p>' : '';
  pane.innerHTML = statLine + truncNote + filesHtml + untrackedHtml;
};

export const ensureDiff = async id => {
  if (diffCache.has(id)) return;
  diffCache.set(id, { loading:true });
  if (selected.id === id && activeTabState.tab === 'diff') renderDiffPane();
  try {
    const res = await api.getDiff(id);
    diffCache.set(id, await res.json());
  } catch {
    diffCache.set(id, { tracked:true, error:'요청 실패' });
  }
  if (selected.id === id && activeTabState.tab === 'diff') renderDiffPane();
};

export const setTab = tab => {
  activeTabState.tab = tab;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#pane-report').classList.toggle('hidden', tab !== 'report');
  $('#pane-diff').classList.toggle('hidden', tab !== 'diff');
  if (tab === 'diff') { ensureDiff(selected.id); renderDiffPane(); }
};
