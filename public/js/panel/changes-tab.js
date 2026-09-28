// Changes tab: renders ChangesView (src/usecases/get-changes.mjs) and refetches it whenever the
// selected session gets a newer event, instead of caching the diff forever.
import { $, $$, escapeHtml } from '../lib/dom.js';
import { renderMarkdown } from '../lib/markdown.js';
import * as api from '../api.js';
import { state, selected, diffCache, activeTabState } from '../store.js';

const STATUS_LABEL = { added: '새 파일', modified: '수정', deleted: '삭제', renamed: '이름 변경' };
const NOT_TRACKED_REASON = {
  'no-folder': '세션 폴더를 찾을 수 없어 변경을 추적할 수 없어요.',
  'not-git': 'Git 저장소가 아니라서 변경을 추적할 수 없어요.',
};

const patchLines = patch => String(patch || '').split('\n').map(l => {
  const cls = l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
  return `<span class="${cls}">${escapeHtml(l)}</span>`;
}).join('\n');

// The + lines of a whole-file "added" patch, content only (leading '+' stripped).
const addedFileText = patch => patch.split('\n')
  .filter(l => l.startsWith('+') && !l.startsWith('+++'))
  .map(l => l.slice(1))
  .join('\n');

// New .md files, whether already committed on the branch or still untracked (both are whole-file additions).
const isPreviewableMd = f => f.status === 'added' && !f.binary && !f.tooLarge && /\.md$/i.test(f.path);

const fileNote = f => f.tooLarge
  ? '<p class="hint">파일이 커서 내용을 생략했어요.</p>'
  : f.binary
    ? '<p class="hint">바이너리 파일이라 미리 볼 수 없어요.</p>'
    : '';

const fileBody = (f, raw) => {
  if (f.tooLarge || f.binary) return fileNote(f);
  if (!isPreviewableMd(f)) return `<pre class="patch">${patchLines(f.patch)}</pre>`;
  return `<div class="file-view-toggle">
      <button type="button" class="seg-btn${raw ? '' : ' active'}" data-view="preview">미리보기</button>
      <button type="button" class="seg-btn${raw ? ' active' : ''}" data-view="raw">원문</button>
    </div>
    <div class="file-view-pane${raw ? ' hidden' : ''}" data-view-pane="preview"><div class="report-sec">${renderMarkdown(addedFileText(f.patch))}</div></div>
    <div class="file-view-pane${raw ? '' : ' hidden'}" data-view-pane="raw"><pre class="patch">${patchLines(f.patch)}</pre></div>`;
};

const fileEntry = (f, i, openPaths, rawPaths) => {
  const open = openPaths ? openPaths.has(f.path) : i < 3;
  const raw = rawPaths ? rawPaths.has(f.path) : false;
  return `<details class="diff-file" data-path="${escapeHtml(f.path)}"${open ? ' open' : ''}>
    <summary>
      <span class="file-path">${escapeHtml(f.path)}</span>
      <span class="file-badge badge-${f.status}">${STATUS_LABEL[f.status] || f.status}</span>
      <span class="file-counts"><span class="add">+${f.add}</span> <span class="del">−${f.del}</span></span>
    </summary>
    <div class="diff-file-body">${fileBody(f, raw)}</div>
  </details>`;
};

const emptyReason = entry => {
  const ref = entry.base?.ref;
  const parts = [];
  if (entry.empty?.committed === false) parts.push(ref ? `기준(${ref})과 같음` : '기준과 같음');
  if (entry.empty?.uncommitted === false) parts.push('커밋 안 된 변경 없음');
  return parts.length ? parts.join(' · ') : '변경 없음';
};

// Which files were open, and in preview or raw, before this render -- so a refresh (new eventAt)
// doesn't collapse what the user had open. Reset whenever the pane last rendered a different
// session, so a stale DOM from the previous selection is never mistaken for "keep this open".
const capturePrior = pane => {
  if (pane.dataset.diffFor !== selected.id) return { open: null, raw: new Set() };
  const els = Array.from(pane.querySelectorAll('.diff-file[data-path]'));
  if (!els.length) return { open: null, raw: new Set() };
  return {
    open: new Set(els.filter(el => el.open).map(el => el.dataset.path)),
    raw: new Set(els.filter(el => el.querySelector('[data-view-pane="raw"]:not(.hidden)')).map(el => el.dataset.path)),
  };
};

export const renderDiffPane = () => {
  const pane = $('#pane-diff');
  const entry = diffCache.get(selected.id);
  if (!entry || entry.loading) { pane.innerHTML = '<p class="hint">변경사항을 불러오는 중...</p>'; return; }
  if (entry.tracked === false) { pane.innerHTML = `<p class="hint">${NOT_TRACKED_REASON[entry.reason] || '변경 추적 불가'}</p>`; return; }
  if (entry.reason === 'error' || entry.error) { pane.innerHTML = `<p class="hint">오류: ${escapeHtml(entry.error || '')}</p>`; return; }

  const { open: prevOpen, raw: prevRaw } = capturePrior(pane);
  const files = entry.files || [];
  const totals = entry.totals || { files: files.length, add: 0, del: 0, added: 0 };
  const headerHtml = files.length
    ? `<p class="diff-stat"><span class="add">+${totals.add}</span> <span class="del">−${totals.del}</span> · ${totals.files}개 파일${totals.added ? ` · 새 파일 ${totals.added}` : ''}</p>`
    : `<p class="diff-stat">${emptyReason(entry)}</p>`;
  const truncNote = entry.truncated ? '<p class="hint">내용이 커서 일부만 표시했어요.</p>' : '';
  const filesHtml = files.map((f, i) => fileEntry(f, i, prevOpen, prevRaw)).join('');

  pane.innerHTML = headerHtml + truncNote + filesHtml;
  pane.dataset.diffFor = selected.id;
};

// Preview/원문 toggle -- delegated so it keeps working across re-renders without extra wiring.
document.addEventListener('click', e => {
  const btn = e.target.closest('#pane-diff .seg-btn');
  if (!btn) return;
  const details = btn.closest('.diff-file');
  const view = btn.dataset.view;
  details.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  details.querySelectorAll('.file-view-pane').forEach(p => p.classList.toggle('hidden', p.dataset.viewPane !== view));
});

const atOf = id => {
  const s = state.sessionsById.get(id);
  return s ? (s.eventAt ?? s.lastAt ?? null) : null;
};

export const ensureDiff = async id => {
  const at = atOf(id);
  const entry = diffCache.get(id);
  if (entry?.loading) return;
  if (entry && entry._at === at) return; // already fresh for this session's latest event
  diffCache.set(id, { ...entry, loading: true });
  if (selected.id === id && activeTabState.tab === 'diff') renderDiffPane();
  try {
    const res = await api.getDiff(id);
    diffCache.set(id, { ...await res.json(), loading: false, _at: at });
  } catch {
    diffCache.set(id, { tracked: true, error: '요청 실패', loading: false, _at: at });
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

// The panel's own poll (panel/panel.js) only re-renders the report pane; check here on the same
// cadence so an open changes tab picks up a newer eventAt without a manual tab switch.
setInterval(() => {
  if (activeTabState.tab === 'diff' && selected.id) ensureDiff(selected.id);
}, 2000);
