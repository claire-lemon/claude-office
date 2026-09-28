import { $, escapeHtml } from '../lib/dom.js';
import { safeAnimal } from './sprites.js';
import { selected, drag } from '../store.js';
import { COLUMNS } from './columns.js';
import { mountColumnResize } from './layout.js';

// ---------- kanban ----------
// Columns come from the COLUMNS table; which column a session sits in comes from the server
// (session.column). Each .kan-col stays a direct child of .kan-columns: layout.js puts the column
// width handles inside them, so later renders only touch the .kan-list.
const kanbanEl = $('.kanban');
const columnsEl = $('.kan-columns');
const buildColumn = c => {
  const el = document.createElement('div');
  el.className = 'kan-col';
  el.dataset.col = c.id;
  const btn = c.headerAction ? `<button type="button" class="col-btn" id="${escapeHtml(c.headerAction.id)}" hidden>${escapeHtml(c.headerAction.label)}</button>` : '';
  el.innerHTML = `<h3 class="col-head">${escapeHtml(c.label)}${btn}</h3><div class="kan-list"></div>`;
  return { def: c, el, list: el.querySelector('.kan-list'), btn: el.querySelector('.col-btn') };
};
const columns = COLUMNS.map(buildColumn);
columnsEl.replaceChildren(...columns.map(c => c.el));
mountColumnResize(columnsEl);
const cardEls = new Map();

const elapsed = ms => {
  const m = Math.floor(Math.max(ms,0)/60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}시간`;
  return `${Math.floor(h/24)}일`;
};
const countReviewItems = report => {
  const body = report && report['리뷰 필요'];
  if (!body) return 0;
  return body.split('\n').filter(l => /^([-*]|\d+[.)])\s+/.test(l)).length; // top-level items only
};
// diffStat: {files, add, del} | null — only present for review/question sessions with a worktree.
// A review with files===0 gets a "변경 없음" warning tag: a done report with no diff deserves a second look.
const diffStatHtml = session => {
  const ds = session.diffStat;
  if (!ds) return '';
  const files = Number(ds.files) || 0;
  const add = Number(ds.add) || 0;
  const del = Number(ds.del) || 0;
  const warn = (session.status === 'review' && files === 0) ? ' <span class="tag-warn">변경 없음</span>' : '';
  return `<span class="ds-add">+${add}</span> <span class="ds-del">−${del}</span> · ${files}개 파일${warn}`;
};

const metaLine = s => {
  if (s.status === 'review') return `리뷰 필요 ${countReviewItems(s.report)}건`;
  if (s.status === 'blocked') return s.message ? String(s.message).slice(0,60) : '확인이 필요해요';
  if (s.status === 'working') return s.eventAt ? `${elapsed(Date.now()-s.eventAt)} 경과` : '진행 중';
  if (s.status === 'question') return s.preview ? String(s.preview).slice(0,40) : '질문이 있어요';
  if (s.status === 'done') return `턴 ${s.turns ?? '-'} · 완료`;
  if (s.status === 'hold') return s.eventAt ? `${elapsed(Date.now()-s.eventAt)} 전 마지막 활동` : '보류 중';
  return '';
};

// Keep the tail of long paths: the worktree / folder name is the part that tells sessions apart.
const shortPath = p => !p ? '-' : p.length > 44 ? `…${p.slice(-43)}` : p;

const buildCard = session => {
  const card = document.createElement('div');
  card.className = 'kan-card';
  card.dataset.id = session.id;
  card.draggable = true; // views/board-dnd.js
  card.innerHTML = `<div class="kan-top"><span class="kan-avatar"><svg viewBox="0 0 24 34"><use href="#animal-${safeAnimal(session.animal)}"/></svg></span><span class="kan-title"></span><span class="kan-tag hidden"></span></div><div class="kan-loc"><div class="loc-proj"></div><div class="loc-branch"></div><div class="loc-cwd"></div></div><div class="kan-meta"></div><div class="kan-diffstat hidden"></div>`;
  return card;
};
const updateCard = (card, session) => {
  card.querySelector('.kan-title').textContent = session.title || '(제목 없음)';
  const tag = card.querySelector('.kan-tag');
  const tagText = session.status === 'review' ? ((session.nextTasks || []).length ? '다음 작업' : '보고서')
    : session.status === 'question' ? '질문' : session.status === 'blocked' ? '막힘' : '';
  tag.textContent = tagText;
  tag.classList.toggle('tag-danger', session.status === 'blocked');
  tag.classList.toggle('hidden', !tagText);
  const proj = card.querySelector('.loc-proj');
  proj.textContent = `📁 ${session.repo || '-'}`;
  proj.title = session.projectPath || '';
  const br = card.querySelector('.loc-branch');
  br.textContent = `🌿 ${session.branch || '브랜치 없음'}`;
  br.title = session.branch || '';
  const cwdEl = card.querySelector('.loc-cwd');
  cwdEl.textContent = `📍 ${shortPath(session.cwd)}`;
  cwdEl.title = session.cwd || '';
  card.querySelector('.kan-meta').textContent = metaLine(session);
  const dsEl = card.querySelector('.kan-diffstat');
  const dsHtml = diffStatHtml(session);
  dsEl.innerHTML = dsHtml;
  dsEl.classList.toggle('hidden', !dsHtml);
  card.classList.toggle('selected', session.id === selected.id);
};

// filter: views/filters.js row. Cards only where filter.match; filter.columns hides the other
// columns, and a lone column spreads its cards over a grid (board.css .kanban.single).
export const renderKanban = (sessions, filter) => {
  if (drag.id) return; // moving DOM mid-drag cancels the HTML5 drag; dragend re-renders
  const visible = columns.filter(c => !filter.columns || filter.columns.includes(c.def.id));
  kanbanEl.classList.toggle('single', visible.length === 1);
  const present = new Set();
  columns.forEach(c => {
    const shown = visible.includes(c);
    c.el.hidden = !shown;
    const cards = shown ? sessions.filter(s => s.column === c.def.id && filter.match(s)) : [];
    if (c.def.sort) cards.sort(c.def.sort);
    cards.forEach(session => {
      const existing = cardEls.get(session.id);
      const card = existing || buildCard(session);
      if (!existing) cardEls.set(session.id, card);
      updateCard(card, session);
      c.list.appendChild(card);
      present.add(session.id);
    });
    if (c.btn) c.btn.hidden = !cards.length;
  });
  Array.from(cardEls.keys()).forEach(id => {
    if (!present.has(id)) { cardEls.get(id).remove(); cardEls.delete(id); }
  });
};
