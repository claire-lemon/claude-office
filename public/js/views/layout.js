// Page layout (docs/specs/2026-09-28-board-interactions-design.md §5.2): office↔board split handle,
// automatic desk size, kanban column widths. At ≥800px the page fits the viewport (base.css);
// below that the page flows naturally and the handles are hidden by CSS.
import { $ } from '../lib/dom.js';
import { fitGrid, resizePair } from '../lib/grid-math.js';
import { mountSplitter } from '../lib/splitter.js';
import { loadPref, savePref } from '../lib/storage.js';

const WIDE = window.matchMedia('(min-width:800px)');
const OFFICE_H = { key: 'office.officeHeight', initial: 300, min: 140, boardMin: 200 };
const COLS = { key: 'office.columns', min: 160 };
// Desk height beyond size * 86/64 (office.css): padding 6+8 + border 2 + nameplate/empty-label
// row 20 (margin 2 + line 16 + padding 2, or margin 4 + line 16) = 36px, but the visual is only
// size − 14px wide (padding 6+6 + border 2), so height = size·ratio + 36 − 14·ratio ≈ size·ratio + 17.2.
const DESK_EXTRA = 36 - 14 * 86 / 64;

// ---------- desk fit ----------
const fit = { desks: null, colsOptions: [], raf: 0 };

const applyFit = () => {
  fit.raf = 0;
  const desks = fit.desks;
  const office = desks.closest('.office');
  const cs = getComputedStyle(office);
  const height = WIDE.matches ? office.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : Infinity;
  const count = desks.querySelectorAll('.desk').length;
  const { cols, size } = fitGrid({
    count, width: desks.clientWidth, height, extra: DESK_EXTRA,
    colsOptions: fit.colsOptions.map(c => Math.min(c, count)), // a filtered office of 7 may sit in one row of 7
  });
  desks.style.setProperty('--desk-cols', String(Math.max(cols, 1)));
  desks.style.setProperty('--desk-w', size ? `${Math.floor(size)}px` : 'auto');
};

// Call after the number of desks changes: ResizeObserver doesn't fire for child-count changes alone.
// rAF-batched, so calling it often is cheap; a no-op until initLayout has run.
export const refitOffice = () => {
  if (!fit.desks || fit.raf) return;
  fit.raf = requestAnimationFrame(applyFit);
};

// ---------- office ↔ board split ----------
const mountOfficeSplit = () => {
  const handle = $('#split-office');
  const mainCol = $('.main-col');
  if (!handle || !mainCol) return;
  const saved = Number(loadPref(OFFICE_H.key, OFFICE_H.initial));
  // pref is the user's height; the applied value is clamped to the current window, pref survives it.
  const split = { pref: Number.isFinite(saved) && saved > 0 ? saved : OFFICE_H.initial, start: 0 };
  const maxH = () => mainCol.clientHeight - OFFICE_H.boardMin;
  const clampH = px => Math.max(OFFICE_H.min, Math.min(px, maxH())); // tiny window: min wins
  const apply = () => {
    const h = Math.round(clampH(split.pref));
    mainCol.style.setProperty('--office-h', `${h}px`);
    handle.setAttribute('aria-valuemin', String(OFFICE_H.min));
    handle.setAttribute('aria-valuemax', String(Math.max(OFFICE_H.min, Math.round(maxH()))));
    handle.setAttribute('aria-valuenow', String(h));
  };
  mountSplitter(handle, {
    axis: 'y',
    label: '사무실·결재함 크기 조정',
    onStart: () => { split.start = clampH(split.pref); },
    onMove: dy => { split.pref = clampH(split.start + dy); apply(); },
    onEnd: () => savePref(OFFICE_H.key, Math.round(split.pref)),
    onReset: () => { split.pref = OFFICE_H.initial; apply(); savePref(OFFICE_H.key, OFFICE_H.initial); },
  });
  new ResizeObserver(apply).observe(mainCol); // window resize, header wrap, panel margin
  apply();
};

// ---------- kanban column widths ----------
const colTemplate = fracs => fracs.map(f => `minmax(0,${Number(f.toFixed(3))}fr)`).join(' ');

// Re-callable and idempotent: works on whatever .kan-col children exist right now, so call it
// again after regenerating the columns. A handle sits in the gap right of every column but the last.
export const mountColumnResize = columnsEl => {
  if (!columnsEl) return;
  columnsEl.querySelectorAll('.col-handle').forEach(h => h.remove());
  const cols = Array.from(columnsEl.children).filter(el => el.classList.contains('kan-col'));
  if (!cols.length) { columnsEl.style.removeProperty('--kan-cols'); return; }
  const stored = loadPref(COLS.key, null);
  const valid = Array.isArray(stored) && stored.length === cols.length && stored.every(f => Number.isFinite(f) && f > 0);
  const st = { fracs: valid ? stored : cols.map(() => 1), start: [], totalPx: 0 };

  const handles = cols.slice(0, -1).map(col => {
    const h = document.createElement('div');
    h.className = 'col-handle';
    h.setAttribute('aria-valuemin', '0');
    h.setAttribute('aria-valuemax', '100');
    col.append(h);
    return h;
  });
  const apply = () => {
    columnsEl.style.setProperty('--kan-cols', colTemplate(st.fracs));
    const total = st.fracs.reduce((a, b) => a + b, 0);
    handles.forEach((h, i) => h.setAttribute('aria-valuenow', String(Math.round(st.fracs[i] / total * 100))));
  };
  const save = () => savePref(COLS.key, st.fracs.map(f => Number(f.toFixed(3))));
  handles.forEach((h, i) => mountSplitter(h, {
    axis: 'x',
    label: '칸 폭 조정',
    onStart: () => {
      const gap = parseFloat(getComputedStyle(columnsEl).columnGap) || 0;
      st.start = st.fracs;
      st.totalPx = columnsEl.clientWidth - gap * (cols.length - 1);
    },
    onMove: dx => { st.fracs = resizePair(st.start, i, dx, st.totalPx, COLS.min); apply(); },
    onEnd: save,
    onReset: () => { st.fracs = cols.map(() => 1); apply(); save(); },
  }));
  apply();
};

// ---------- init (main.js, once) ----------
export const initLayout = ({ seats }) => {
  mountOfficeSplit();
  fit.desks = $('#desks');
  fit.colsOptions = [seats.maxPerRow, seats.block];
  const ro = new ResizeObserver(refitOffice);
  ro.observe(fit.desks); // width: panel open, decor column hidden on phones
  ro.observe(fit.desks.closest('.office')); // height: split handle drag, window resize
  WIDE.addEventListener('change', refitOffice); // height switches between the office box and Infinity
  mountColumnResize($('.kan-columns'));
  refitOffice();
};
