import { escapeHtml } from '../lib/dom.js';
import { inlineEdit } from '../lib/inline-edit.js';
import * as api from '../api.js';
import { controls, drag } from '../store.js';
import { safeAnimal } from './sprites.js';
import { COLUMNS } from './columns.js';
import { flashPanelError } from './toast.js';
import { isBlackboardOpen, setBlackboardOpen } from './layout.js';

// 오늘의 할 일 칠판 (docs/specs/2026-09-28-todo-blackboard-design.md §9). The server computes each
// todo's status and linked sessions; this view shows them, edits what the user wrote, and applies
// check / delete / start optimistically until the next 2s poll brings the server's answer.

const COLUMN_LABEL = Object.fromEntries(COLUMNS.map(c => [c.id, c.label]));
// Linked sessions that left the board get a lean status from the server (design §6.2).
const OFF_BOARD_LABEL = { archived: '보관됨', stale: '지난 세션' };
const ADD_ERRORS = {
  'title required': '제목을 적어주세요',
  'title too long': '제목은 120자까지예요',
  'folder must be an absolute path': '폴더는 절대 경로로 적어주세요',
  'folder not found': '폴더를 찾지 못했어요',
};
const START_ERRORS = { 'repo folder not found': '레포 폴더를 찾지 못했어요' };
// Chip tooltip: how the session came to this todo (finishing-touches design §4.3.3).
const VIA_LABEL = { assigned: ' · 배정됨', marker: ' · 칠판에서 시작' };

// data: store.todos ({ list, deleted, folders }); optimistic updates write into it, the poll replaces it.
const view = { el: null, data: { list: [], deleted: [], folders: [] }, sessionsById: new Map(), onChange: () => {} };
// adding: add form open (renders never touch it). memo: ids with the detail textarea open.
// starting: ids waiting on POST /api/start. history: ids with the earlier-sessions list open (design §3.5).
// refining: ids waiting on POST /api/refine. proposal: id -> ✨ proposed detail shown in place of the memo;
// an item with one open is left alone by renders, like one being edited (finishing-touches design §3.2).
const ui = { adding: false, memo: new Set(), starting: new Set(), history: new Set(), refining: new Set(), proposal: new Map() };
const itemEls = new Map(); // todo id -> { el, html }: html is the last markup, unchanged = DOM left alone
const refs = { trashHtml: '' };

const ADD_BTN = '<button type="button" class="bb-add-btn" data-act="add">+ 할 일 추가</button>';
const SHELL = `
  <div class="bb-head">
    <h2 class="bb-title">오늘의 할 일 <span class="bb-count"></span></h2>
    <button type="button" class="bb-fold" data-act="fold" aria-expanded="true" title="칠판 접기">▾</button>
  </div>
  <button type="button" class="bb-strip" data-act="fold" aria-expanded="false" title="칠판 펼치기">▸ 📋 할 일 <span class="bb-count"></span></button>
  <div class="bb-scroll">
    <p class="bb-empty">오늘 할 일을 적어보세요</p>
    <ul class="bb-list"></ul>
    <details class="bb-trash" hidden><summary>오늘 지운 항목 <span class="bb-trash-n"></span></summary><ul class="bb-trash-list"></ul></details>
  </div>
  <div class="bb-add">${ADD_BTN}</div>`;

// ---------- items ----------
const chipState = s => (OFF_BOARD_LABEL[s.status] ? s.status : s.column || 'stale');
const chipLabel = s => OFF_BOARD_LABEL[s.status] ?? COLUMN_LABEL[s.column] ?? OFF_BOARD_LABEL.stale;

// Linked session: animal face (+ label html) + status chip. Only a session on the board has a panel to open.
const workerHtml = (s, label = '') => {
  const inner = `<svg viewBox="0 0 24 34" aria-hidden="true"><use href="#animal-${safeAnimal(s.animal)}"></use></svg>${label}<span class="bb-chip" data-state="${escapeHtml(chipState(s))}">${escapeHtml(chipLabel(s))}</span>`;
  const title = escapeHtml(`${s.title}${VIA_LABEL[s.via] ?? ''}`);
  return view.sessionsById.has(s.id)
    ? `<button type="button" class="bb-worker" data-act="worker" data-session="${escapeHtml(s.id)}" title="${title} · 패널 열기">${inner}</button>`
    : `<span class="bb-worker" title="${title}">${inner}</span>`;
};

const pad2 = n => String(n).padStart(2, '0');
const stamp = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
// One earlier session: face · title · chip (one button while on the board) · MM-DD HH:MM (· × if assigned).
const unassignHtml = s => (s.via === 'assigned'
  ? `<button type="button" class="bb-icon bb-unassign" data-act="unassign" data-session="${escapeHtml(s.id)}" aria-label="배정 해제: ${escapeHtml(s.title)}" title="배정 해제">×</button>`
  : '');
const histHtml = s => `<li>${workerHtml(s, `<span class="bb-hist-title">${escapeHtml(s.title)}</span>`)}<span class="bb-hist-at">${stamp(s.decidedAt ?? s.lastAt)}</span>${unassignHtml(s)}</li>`;

const startLabel = t => (ui.starting.has(t.id) ? '여는 중…' : t.status === 'started' ? '다시 시작' : '시작');

// Memo area: the textarea, and ✨ 다듬기 under it while the todo is not done.
const memoHtml = (t, done) => {
  const busy = ui.refining.has(t.id);
  const refine = done ? '' : `<div class="bb-memo-bar"><button type="button" class="bb-btn" data-act="refine"${busy ? ' disabled title="최대 1분쯤 걸려요"' : ''}>${busy ? '다듬는 중…' : '✨ 다듬기'}</button></div>`;
  return `<textarea class="bb-detail" maxlength="2000" rows="3" placeholder="세부 메모 · 새 세션 프롬프트에 들어가요" aria-label="세부 메모"></textarea>${refine}`;
};
// Not .bb-detail: a blur here must not save the proposal as the memo (only 적용 does).
const PROPOSAL_HTML = `<div class="bb-prop">
      <div class="bb-prop-bar"><span class="bb-prop-badge">✨ AI 제안</span><button type="button" class="bb-btn bb-ghost" data-act="refine-cancel">취소</button><button type="button" class="bb-btn" data-act="refine-apply">적용</button></div>
      <textarea class="bb-refine" maxlength="2000" rows="8" aria-label="AI 제안 메모 · 고쳐서 적용할 수 있어요 · ⌘Enter 적용, Esc 취소"></textarea>
    </div>`;

// Structure only. Title and detail are filled by paintItem as properties, so saving them on blur
// never rebuilds the item under the pointer (the click that caused the blur would be lost).
const itemHtml = t => {
  const done = t.status === 'done';
  const start = done ? '' : `<button type="button" class="bb-btn bb-start" data-act="start"${ui.starting.has(t.id) ? ' disabled' : ''}>${startLabel(t)}</button>`;
  const memoOpen = ui.memo.has(t.id);
  const earlier = (t.sessions || []).slice(1).reverse(); // server sends recent first; history reads oldest first
  const histOpen = earlier.length > 0 && ui.history.has(t.id);
  const more = earlier.length ? `<button type="button" class="bb-more" data-act="history" aria-expanded="${histOpen}" aria-label="이전 세션 ${earlier.length}개" title="이전 세션 ${earlier.length}개">+${earlier.length}</button>` : '';
  return `<div class="bb-row">
      <input type="checkbox" class="bb-check" data-act="toggle"${done ? ' checked' : ''}>
      ${t.source === 'scrum' ? '<span class="bb-scrum" title="회의실에서 추가">🏫</span>' : ''}<span class="bb-name" data-act="title" role="button" tabindex="0" title="클릭해서 제목 바꾸기"></span>
      <button type="button" class="bb-icon bb-memo" data-act="edit-detail" aria-expanded="${memoOpen}">메모</button>
      <button type="button" class="bb-icon bb-del" data-act="delete" aria-label="삭제" title="삭제">🗑</button>
    </div>
    <div class="bb-meta">
      <span class="bb-proj" title="${escapeHtml(t.folder)}">📁 ${escapeHtml(t.project || '-')}</span>
      ${t.latest ? workerHtml(t.latest) : ''}${more}
      ${start}
    </div>
    ${histOpen ? `<ol class="bb-hist" aria-label="이전 세션">${earlier.map(histHtml).join('')}</ol>` : ''}
    ${ui.proposal.has(t.id) ? PROPOSAL_HTML : memoOpen ? memoHtml(t, done) : ''}`;
};

const isEditing = el => !!el.querySelector('[data-editing]');
const frozen = (id, el) => isEditing(el) || ui.proposal.has(id);

const paintItem = (entry, t) => {
  const { el } = entry;
  el.classList.toggle('done', t.status === 'done');
  el.dataset.status = t.status;
  // a 결재함 card dropped here is assigned to this todo (views/board-dnd.js)
  if (t.status === 'done') delete el.dataset.dropTodo;
  else el.dataset.dropTodo = t.id;
  const html = itemHtml(t);
  if (html !== entry.html) {
    const { act, session } = el.contains(document.activeElement) ? document.activeElement.dataset : {};
    el.innerHTML = html;
    entry.html = html;
    // keyboard focus survives a re-render (a worker chip: the same session's, latest or history)
    if (act) el.querySelector(`[data-act="${act}"]${session ? `[data-session="${CSS.escape(session)}"]` : ''}`)?.focus();
  }
  el.querySelector('.bb-name').textContent = t.title;
  el.querySelector('.bb-check').setAttribute('aria-label', `완료: ${t.title}`);
  const memo = el.querySelector('.bb-memo');
  memo.classList.toggle('has-detail', !!t.detail);
  memo.title = t.detail || '메모 추가';
  const area = el.querySelector('.bb-detail');
  if (area) area.value = t.detail || '';
  const prop = el.querySelector('.bb-refine');
  if (prop) prop.value = ui.proposal.get(t.id); // painted once, when it opens: then the item is frozen
};

const drawDeleted = () => {
  const list = view.data.deleted;
  refs.trash.hidden = !list.length;
  refs.trashN.textContent = String(list.length);
  const html = list.map(d => `<li data-todo="${escapeHtml(d.id)}"><span class="bb-trash-title">${escapeHtml(d.title)}</span><button type="button" class="bb-btn" data-act="restore">되돌리기</button></li>`).join('');
  if (html === refs.trashHtml) return;
  refs.trashList.innerHTML = html;
  refs.trashHtml = html;
};

const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

// Keyed: an item keeps its element; an item being edited is neither repainted nor removed nor moved.
const draw = () => {
  const items = [...view.data.list].sort(byCreated);
  const left = items.filter(t => t.status !== 'done').length;
  refs.counts.forEach(c => { c.textContent = String(left); });
  refs.empty.hidden = items.length > 0;
  const ids = new Set(items.map(t => t.id));
  itemEls.forEach((entry, id) => {
    if (ids.has(id) || frozen(id, entry.el)) return;
    entry.el.remove();
    itemEls.delete(id);
  });
  items.forEach((t, i) => {
    const entry = itemEls.get(t.id) ?? { el: Object.assign(document.createElement('li'), { className: 'bb-item' }), html: '' };
    if (!itemEls.has(t.id)) { entry.el.dataset.todo = t.id; itemEls.set(t.id, entry); }
    if (!frozen(t.id, entry.el)) paintItem(entry, t);
    if (refs.list.children[i] !== entry.el) refs.list.insertBefore(entry.el, refs.list.children[i] ?? null);
  });
  drawDeleted();
};

// ---------- actions ----------
const findTodo = id => view.data.list.find(t => t.id === id);
const putTodo = (id, next) => { view.data.list = view.data.list.map(t => (t.id === id ? next : t)); };

// Optimistic edit: show `local` now, send `body`, then adopt the server's todo or roll back.
const mutate = async (id, local, body, failMsg, okMsg = '') => {
  const prev = findTodo(id);
  if (!prev) return;
  putTodo(id, { ...prev, ...local });
  draw();
  try {
    const res = await api.patchTodo(id, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error);
    if (data.todo) putTodo(id, data.todo);
    if (okMsg) flashPanelError(okMsg);
  } catch {
    putTodo(id, prev);
    flashPanelError(failMsg);
  }
  draw();
  view.onChange();
};

// Unchecking a todo with a linked session lands on started, not open (design §5 step 3).
const toggle = id => {
  const t = findTodo(id);
  if (!t) return;
  const done = t.status !== 'done';
  const local = done
    ? { status: 'done', doneAt: Date.now(), by: 'manual' }
    : { status: (t.sessions || []).length ? 'started' : 'open', doneAt: null, by: 'manual' };
  mutate(id, local, { done }, '체크를 저장하지 못했어요');
};

const editTitle = (id, el) => {
  const t = findTodo(id);
  if (!t) return;
  inlineEdit(el, {
    value: t.title,
    maxLength: 120,
    onCommit: title => { if (title) mutate(id, { title }, { title }, '제목을 저장하지 못했어요'); }, // empty = keep
  });
};

const toggleMemo = id => {
  if (ui.memo.has(id)) ui.memo.delete(id);
  else ui.memo.add(id);
  draw();
  if (ui.memo.has(id)) itemEls.get(id)?.el.querySelector('.bb-detail')?.focus();
};

const toggleHistory = id => {
  if (ui.history.has(id)) ui.history.delete(id);
  else ui.history.add(id);
  draw();
};

const saveDetail = (id, area) => {
  delete area.dataset.editing;
  const t = findTodo(id);
  const detail = area.value.trim();
  if (!t || detail === (t.detail || '')) return;
  mutate(id, { detail }, { detail }, '메모를 저장하지 못했어요');
};

// ✨ 다듬기 (finishing-touches design §3.2): the server writes a proposed detail from the todo, its
// sessions and today's narrative. Nothing is saved until 적용; 취소 leaves the memo as it was.
const refine = async id => {
  if (ui.refining.has(id)) return;
  ui.refining.add(id);
  draw();
  const res = await api.postRefine(id).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  ui.refining.delete(id);
  if (res?.ok && typeof data.detail === 'string') openProposal(id, data.detail);
  else flashPanelError(res?.status === 404 ? '할 일을 찾지 못했어요' : '다듬지 못했어요');
  draw();
};

const openProposal = (id, detail) => {
  const entry = itemEls.get(id);
  if (!entry || !findTodo(id)) return;
  if (entry.el.contains(document.activeElement)) document.activeElement.blur(); // a memo / title being typed saves first
  ui.proposal.set(id, detail);
  paintItem(entry, findTodo(id));
  entry.el.querySelector('.bb-refine')?.focus();
};

const closeProposal = id => {
  ui.proposal.delete(id);
  draw();
  itemEls.get(id)?.el.querySelector('.bb-memo')?.focus();
};

// The existing memo save path; the memo opens so what was saved is in view.
const applyProposal = id => {
  const detail = itemEls.get(id)?.el.querySelector('.bb-refine')?.value.trim() ?? '';
  ui.memo.add(id);
  closeProposal(id);
  const t = findTodo(id);
  if (t && detail !== (t.detail || '')) mutate(id, { detail }, { detail }, '메모를 저장하지 못했어요');
};

// [×] on an assigned session in the +n list (design §4.3.3). Only earlier sessions get one, so `latest` holds.
const unassign = (id, sessionId) => {
  const t = findTodo(id);
  if (!t || !sessionId) return;
  const sessions = (t.sessions || []).filter(s => s.id !== sessionId);
  mutate(id, { sessions, latest: sessions[0] ?? null }, { unassign: sessionId }, '배정을 해제하지 못했어요', '배정을 해제했어요');
};

// flashPanelError renders text only; this toast carries a 되돌리기 button (same .toast look).
const undoToast = (text, onUndo, ms = 5000) => {
  const t = document.createElement('div');
  t.className = 'toast bb-toast';
  t.setAttribute('role', 'status');
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'bb-undo', textContent: '되돌리기' });
  t.append(`${text} · `, btn);
  const timer = setTimeout(() => t.remove(), ms);
  btn.addEventListener('click', () => { clearTimeout(timer); t.remove(); onUndo(); });
  document.body.appendChild(t);
};

// 되돌리기 (toast or the 지운 항목 list) revives the same id, so its session links hold (design §3.7).
// snapshot: the deleted view, shown again right away; the list only has { id, title }, so it waits for the server.
const restore = async (id, snapshot) => {
  const { data } = view;
  const before = data.deleted;
  data.deleted = data.deleted.filter(d => d.id !== id);
  if (snapshot && !findTodo(id)) data.list = [...data.list, snapshot];
  draw();
  try {
    const res = await api.patchTodo(id, { deleted: false });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error);
    if (body.todo) data.list = [...data.list.filter(t => t.id !== id), body.todo];
  } catch {
    data.list = data.list.filter(t => t.id !== id);
    data.deleted = before;
    flashPanelError('되돌리지 못했어요');
  }
  draw();
  view.onChange();
};

// Soft delete: gone now, 되돌리기 for 5s once the server has it (an earlier undo could race the delete).
const remove = async id => {
  const t = findTodo(id);
  if (!t) return;
  const { data } = view;
  data.list = data.list.filter(x => x.id !== id);
  draw();
  try {
    const res = await api.deleteTodo(id);
    if (!res.ok) throw new Error();
    data.deleted = [...data.deleted.filter(d => d.id !== id), { id, title: t.title }];
    undoToast('삭제됨', () => restore(id, t));
  } catch {
    if (!findTodo(id)) data.list = [...data.list, t];
    flashPanelError('삭제하지 못했어요');
  }
  draw();
  view.onChange();
};

// The item stays open until the user presses Enter in the new session (design §9.5).
const start = async id => {
  if (ui.starting.has(id)) return;
  ui.starting.add(id);
  draw();
  try {
    const res = await api.postStart(id);
    const data = await res.json().catch(() => ({}));
    if (res.ok) flashPanelError('새 세션 입력창을 열었어요 · Enter만 누르세요', 6000);
    else flashPanelError(START_ERRORS[data.error] ?? '시작하지 못했어요');
  } catch {
    flashPanelError('시작하지 못했어요');
  }
  ui.starting.delete(id);
  draw();
  view.onChange();
};

// ---------- add form ----------
// "직접 입력…" is the empty value: real folders are absolute paths.
const formHtml = folders => `<div class="bb-form">
  <input class="bb-in" name="title" maxlength="120" placeholder="할 일 제목" aria-label="할 일 제목">
  <select class="bb-in" name="folder" aria-label="프로젝트 폴더">${folders.map(f => `<option value="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</option>`).join('')}<option value="">직접 입력…</option></select>
  <input class="bb-in" name="folderText" placeholder="/Users/…/repo (절대 경로)" aria-label="폴더 절대 경로"${folders.length ? ' hidden' : ''}>
  <textarea class="bb-in" name="detail" maxlength="2000" rows="3" placeholder="세부 메모 (선택) · ⌘Enter 저장" aria-label="세부 메모"></textarea>
  <div class="bb-form-btns"><button type="button" class="bb-btn bb-ghost" data-act="cancel">취소</button><button type="button" class="bb-btn" data-act="save">저장</button></div>
</div>`;

const field = name => refs.add.querySelector(`[name="${name}"]`);

const openForm = () => {
  if (ui.adding) return;
  ui.adding = true;
  refs.add.innerHTML = formHtml(view.data.folders);
  field('title').focus();
};

const closeForm = () => {
  ui.adding = false;
  refs.add.innerHTML = ADD_BTN;
  refs.add.querySelector('.bb-add-btn').focus();
};

// Not optimistic: a rejected folder keeps the form (and what was typed) open.
const saveForm = async () => {
  const btn = refs.add.querySelector('[data-act="save"]');
  if (!btn || btn.disabled) return;
  const title = field('title').value.trim();
  const folder = field('folder').value || field('folderText').value.trim();
  const detail = field('detail').value.trim();
  if (!title) { field('title').focus(); flashPanelError('제목을 적어주세요'); return; }
  if (!folder) { field('folderText').focus(); flashPanelError('폴더를 골라주세요'); return; }
  btn.disabled = true;
  try {
    const res = await api.postTodo({ title, folder, detail });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error);
    if (data.todo && !findTodo(data.todo.id)) view.data.list = [...view.data.list, data.todo];
    closeForm();
    draw();
    view.onChange();
  } catch (err) {
    btn.disabled = false;
    flashPanelError(ADD_ERRORS[err.message] ?? '저장하지 못했어요');
  }
};

// ---------- events ----------
const ACTIONS = {
  toggle,
  start,
  delete: remove,
  restore: id => restore(id),
  'edit-detail': toggleMemo,
  history: toggleHistory,
  refine,
  'refine-apply': applyProposal,
  'refine-cancel': closeProposal,
  unassign: (id, btn) => unassign(id, btn.dataset.session),
  title: editTitle,
  worker: (id, btn) => controls.selectSession(btn.dataset.session),
  add: openForm,
  save: saveForm,
  cancel: closeForm,
  fold: () => {
    setBlackboardOpen(!isBlackboardOpen());
    view.el.querySelector(isBlackboardOpen() ? '.bb-fold' : '.bb-strip').focus(); // the pressed button just hid
  },
};

const onClick = e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !view.el.contains(btn) || btn.disabled || !Object.hasOwn(ACTIONS, btn.dataset.act)) return;
  ACTIONS[btn.dataset.act](btn.closest('[data-todo]')?.dataset.todo, btn);
};

const onKeydown = e => {
  const t = e.target;
  const id = t.closest('[data-todo]')?.dataset.todo;
  const inForm = !!t.closest('.bb-form');
  const inMemo = t.matches('.bb-detail');
  const inProposal = !!t.closest('.bb-prop');
  if (e.key === 'Escape' && inProposal) {
    e.preventDefault();
    e.stopPropagation(); // not also the panel / meeting screen (main.js)
    closeProposal(id);
    return;
  }
  if (e.key === 'Escape' && (inForm || inMemo)) {
    e.preventDefault();
    e.stopPropagation(); // main.js closes the panel on a document-level Escape
    if (inForm) { closeForm(); return; }
    t.value = findTodo(id)?.detail || '';
    t.blur();
    return;
  }
  if (t.matches('.bb-name') && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); editTitle(id, t); return; }
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // Korean IME: this Enter confirms a syllable
  const mod = e.metaKey || e.ctrlKey;
  if (inMemo && mod) { e.preventDefault(); t.blur(); return; }
  if (inProposal && mod && t.matches('.bb-refine')) { e.preventDefault(); applyProposal(id); return; }
  if (inForm && (t.tagName === 'INPUT' || (t.tagName === 'TEXTAREA' && mod))) { e.preventDefault(); saveForm(); }
};

const onChangeEvent = e => {
  if (e.target.name !== 'folder' || !e.target.closest('.bb-form')) return;
  const text = field('folderText');
  text.hidden = e.target.value !== '';
  if (!text.hidden) text.focus();
};

// ---------- public ----------
// Once, at load. onChange: called after every action (main.js passes its poll).
export const mountBlackboard = (el, { onChange = () => {} } = {}) => {
  if (!el) return;
  view.el = el;
  view.onChange = onChange;
  el.innerHTML = SHELL;
  refs.counts = Array.from(el.querySelectorAll('.bb-count'));
  refs.empty = el.querySelector('.bb-empty');
  refs.list = el.querySelector('.bb-list');
  refs.trash = el.querySelector('.bb-trash');
  refs.trashN = el.querySelector('.bb-trash-n');
  refs.trashList = el.querySelector('.bb-trash-list');
  refs.add = el.querySelector('.bb-add');
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeydown);
  el.addEventListener('change', onChangeEvent);
  el.addEventListener('focusin', e => { if (e.target.matches('.bb-detail')) e.target.dataset.editing = '1'; });
  el.addEventListener('focusout', e => {
    if (e.target.matches('.bb-detail')) saveDetail(e.target.closest('[data-todo]').dataset.todo, e.target);
  });
  draw();
};

// data: store.todos ({ list, deleted, folders }). The add form is never touched here.
// Not while a card is dragged: board-dnd.js marks the items as drop targets; the poll after dragend repaints.
export const renderBlackboard = (data, sessionsById) => {
  if (!view.el) return;
  view.data = data;
  view.sessionsById = sessionsById;
  if (!drag.id) draw();
};
