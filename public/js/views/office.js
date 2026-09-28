import { $ } from '../lib/dom.js';
import { ANIMALS, safeAnimal } from './sprites.js';

// ---------- desk / character svg ----------
// viewBox is fixed (64x86) for every desk regardless of status, so all 10 desks render at an
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
  question: '<div class="bubble"><span class="b-icon">❓</span><span class="b-text">질문 있어요</span></div>',
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

// ---------- desk slot assignment (stable positions across polls) ----------
const deskSlots = new Array(10).fill(null);
const assignDesks = sessions => {
  const idSet = new Set(sessions.map(s => s.id));
  deskSlots.forEach((id,i) => { if (id && !idSet.has(id)) deskSlots[i] = null; });
  const already = new Set(deskSlots.filter(Boolean));
  sessions.forEach(s => {
    if (already.has(s.id)) return;
    const freeIdx = deskSlots.indexOf(null);
    if (freeIdx !== -1) { deskSlots[freeIdx] = s.id; already.add(s.id); }
  });
};

const desksContainer = $('#desks');
const deskEls = Array.from({length:10}, (_,i) => {
  const el = document.createElement('div');
  el.className = 'desk empty';
  el.dataset.slot = String(i);
  el.innerHTML = '<div class="desk-visual"></div><div class="nameplate"></div><div class="bubble-slot"></div><div class="empty-label">빈 자리</div>';
  desksContainer.appendChild(el);
  return el;
});
deskEls.forEach(el => { el.querySelector('.desk-visual').innerHTML = emptyDeskSvg(); el.querySelector('.desk-visual').dataset.empty = '1'; });

export const renderOffice = sessionsById => {
  const list = Array.from(sessionsById.values());
  assignDesks(list);
  deskSlots.forEach((id,i) => renderDesk(deskEls[i], id ? sessionsById.get(id) : null));
};

// ---------- window day/night ----------
export const updateWindow = () => {
  const h = new Date().getHours();
  $('#window-svg').classList.toggle('night', !(h >= 6 && h < 18));
};
