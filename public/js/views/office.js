import { $ } from '../lib/dom.js';
import { seatCount, assignSeats } from '../lib/grid-math.js';
import { ANIMALS, safeAnimal } from './sprites.js';
import { refitOffice } from './layout.js';

// Seats open `block` at a time (a full office opens the next block of empty desks) and a row holds
// at most `maxPerRow` desks (views/layout.js picks block or maxPerRow columns, whichever fits larger).
export const SEATS = { block: 5, maxPerRow: 10 };

// ---------- desk / character svg ----------
// viewBox is fixed (64x86) for every desk regardless of status, so all desks render at an
// identical size; the character is drawn at 1.8x scale so the animal reads as the focal point.
const emptyDeskSvg = () => `<svg viewBox="0 0 64 86">
  <rect x="20" y="30" width="24" height="34" rx="3" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/>
  <rect x="2" y="70" width="60" height="4" fill="var(--desk-edge)"/>
  <rect x="2" y="74" width="60" height="12" fill="var(--desk)"/>
</svg>`;

const monitorFill = session => session.status === 'unknown' ? '#cfd3da' : `hsl(${Number(session.repoHue)||0} 60% 82%)`;

const deskSvg = session => {
  const animal = safeAnimal(session.animal);
  const cfg = ANIMALS[animal];
  const strokeAttr = cfg.stroke ? ` stroke="${cfg.stroke}" stroke-width="0.6"` : '';
  return `<svg viewBox="0 0 64 86">
    <rect x="18" y="2" width="28" height="18" rx="1" class="mon-screen" style="fill:${monitorFill(session)}"/>
    <rect class="code-line" x="21" y="6" width="11" height="1.8" fill="rgba(255,255,255,.75)"/>
    <rect class="code-line" x="21" y="10" width="18" height="1.8" fill="rgba(255,255,255,.6)"/>
    <rect class="code-line" x="21" y="14" width="8" height="1.8" fill="rgba(255,255,255,.75)"/>
    <rect x="29" y="20" width="6" height="5" fill="#9a9a9a"/>
    <rect x="18" y="25" width="28" height="2" fill="#9a9a9a"/>
    <g transform="translate(10.4,24) scale(1.8)"><!-- sizing lives here: CSS animation on .char-group would override a transform attribute -->
      <g class="char-group">
        <use href="#animal-${animal}" x="0" y="0" width="24" height="34"/>
        <rect class="arm-l" x="2" y="25" width="4" height="6" fill="${cfg.body}"${strokeAttr}/>
        <rect class="arm-r" x="18" y="25" width="4" height="6" fill="${cfg.body}"${strokeAttr}/>
      </g>
    </g>
    <rect x="2" y="70" width="60" height="4" fill="var(--desk-edge)"/>
    <rect x="2" y="74" width="60" height="12" fill="var(--desk)"/>
  </svg>`;
};

const BUBBLE_HTML = {
  working: '<div class="bubble"><span class="b-icon">⌨️</span><span class="b-text">타닥타닥</span></div>',
  review: '<div class="bubble"><span class="b-icon anim-wave-emoji">🖐️</span><span class="b-text">보고드려요</span><span class="b-paper">📄</span></div>',
  // 'question' = Stop without a 결재 보고 block (domain/status.mjs); the status id stays for API compatibility.
  question: '<div class="bubble"><span class="b-icon">💬</span><span class="b-text">보고 없음</span></div>',
  blocked: '<div class="bubble bubble-danger"><span class="b-icon">💦</span><span class="b-text">도와주세요</span></div>',
  done: '<div class="bubble"><span class="b-icon">☕<span class="steam s1"></span><span class="steam s2"></span></span><span class="b-text">완료</span></div>',
  hold: '<div class="bubble"><span class="b-icon">⏸️</span><span class="b-text">보류</span></div>',
  unknown: '',
};

const renderDesk = (el, session) => {
  el.classList.toggle('empty', !session);
  el.classList.toggle('occupied', !!session);
  const visual = el.querySelector('.desk-visual');
  if (!session) {
    el.dataset.id = ''; el.dataset.status = '';
    if (!visual.dataset.empty) { visual.innerHTML = emptyDeskSvg(); visual.dataset.empty = '1'; }
    el.querySelector('.nameplate').textContent = '';
    el.querySelector('.bubble-slot').innerHTML = '';
    return;
  }
  if (el.dataset.id !== session.id || visual.dataset.empty || visual.dataset.animal !== session.animal) {
    visual.innerHTML = deskSvg(session);
    visual.dataset.empty = '';
    visual.dataset.animal = session.animal;
  } else {
    const scr = visual.querySelector('.mon-screen');
    if (scr) scr.style.fill = monitorFill(session);
  }
  el.dataset.id = session.id;
  el.dataset.status = session.status;
  el.querySelector('.nameplate').textContent = session.title || '(제목 없음)';
  const charGroup = visual.querySelector('.char-group');
  if (charGroup) charGroup.classList.toggle('grayscale', session.status === 'unknown');
  el.querySelector('.bubble-slot').innerHTML = BUBBLE_HTML[session.status] || '';
};

// ---------- seats (stable positions across polls) ----------
const desksContainer = $('#desks');
const deskEls = [];
const seats = { ids: [] }; // seat index -> session id | null, from the last unfiltered render
const emptyHint = Object.assign(document.createElement('p'), { className: 'hint desks-empty', hidden: true, textContent: '해당하는 사원이 없어요' });
desksContainer.append(emptyHint);

const makeDesk = () => {
  const el = document.createElement('div');
  el.className = 'desk empty';
  el.innerHTML = `<div class="desk-visual" data-empty="1">${emptyDeskSvg()}</div><div class="nameplate"></div><div class="bubble-slot"></div><div class="empty-label">빈 자리</div>`;
  return el;
};

// Grow/shrink the desk elements to `total`; returns whether the count changed.
const syncDeskCount = total => {
  const added = Array.from({ length: Math.max(total - deskEls.length, 0) }, makeDesk);
  added.forEach(el => { el.dataset.slot = String(deskEls.length); deskEls.push(el); });
  desksContainer.append(...added);
  const removed = deskEls.splice(total);
  removed.forEach(el => el.remove());
  return added.length > 0 || removed.length > 0;
};

// Filtered view: only the given sessions, no empty seats, in their usual seat order. seats.ids is left
// alone so clearing the filter puts everyone back where they sat.
const filteredSlots = ids => {
  const pos = new Map(seats.ids.map((id, i) => [id, i]));
  const at = id => (pos.has(id) ? pos.get(id) : seats.ids.length);
  return [...ids].sort((a, b) => at(a) - at(b));
};

export const renderOffice = (sessions, { showEmpty = true } = {}) => {
  const byId = new Map(sessions.map(s => [s.id, s]));
  const ids = sessions.map(s => s.id);
  if (showEmpty) seats.ids = assignSeats(seats.ids, ids, seatCount(ids.length, SEATS.block));
  const slots = showEmpty ? seats.ids : filteredSlots(ids);
  const changed = syncDeskCount(slots.length);
  slots.forEach((id, i) => renderDesk(deskEls[i], id ? byId.get(id) : null));
  emptyHint.hidden = showEmpty || ids.length > 0;
  if (changed) refitOffice();
};
renderOffice([]); // first empty block before the first poll, so the office never flashes empty

// ---------- window day/night ----------
// 회의 중 on the office door: today's facilitator is still on the board (회의 끝 archives it; the
// server's facilitators() in usecases/meeting.mjs picks today's the same way, by the #meeting-<date>- id).
const todayPrefix = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-`;
};
// busy: the facilitator is working on a reply (정리 중), the lamp blinks fast; otherwise it glows slowly.
export const updateDoor = list => {
  const door = $('.office-decor .door');
  if (!door) return;
  const prefix = todayPrefix();
  const hosts = list.filter(s => s.meetingId?.startsWith(prefix));
  const busy = hosts.some(s => s.status === 'working');
  door.classList.toggle('on', hosts.length > 0);
  door.classList.toggle('busy', busy);
  door.querySelector('.door-sign').textContent = hosts.length ? '회의 중' : '회의실';
  door.title = busy ? '회의 중 · 진행자가 정리하는 중 · 들어가기' : hosts.length ? '회의 중 · 들어가기' : '회의실 들어가기';
};

export const updateWindow = () => {
  const h = new Date().getHours();
  $('#window-svg').classList.toggle('night', !(h >= 6 && h < 18));
};
