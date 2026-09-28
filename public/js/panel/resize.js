// Panel width resize handle (docs/specs/2026-09-28-layering-and-panel-design.md §6.3).
// clampWidth is pure (no DOM access at module top level) so it's importable from Node tests.
import { loadPanelWidth, savePanelWidth } from '../lib/storage.js';

export const clampWidth = (px, viewportWidth, { min = 320, maxRatio = 0.7 } = {}) => {
  const max = viewportWidth * maxRatio;
  if (max <= min) return min; // tiny viewport: the ratio cap would be below min, so min wins
  return Math.min(Math.max(px, min), max);
};

export const mountResize = (panelEl, opts = {}) => {
  const { min = 320, maxRatio = 0.7, initial = 380 } = opts;
  const cfg = { min, maxRatio };

  const handle = panelEl.querySelector('.panel-resize-handle');
  if (!handle) return; // markup missing: nothing to wire up

  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');
  handle.title = '크기 조정';

  // Mutable UI state kept in one const object (no let/var per project style).
  const state = { width: initial, dragging: false };

  const setValueNow = () => {
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(Math.round(window.innerWidth * maxRatio)));
    handle.setAttribute('aria-valuenow', String(Math.round(state.width)));
  };

  const setWidth = (px, { persist = false } = {}) => {
    state.width = clampWidth(px, window.innerWidth, cfg);
    document.documentElement.style.setProperty('--panel-w', `${state.width}px`);
    setValueNow();
    if (persist) savePanelWidth(state.width);
    return state.width;
  };

  setWidth(loadPanelWidth() || initial);

  handle.addEventListener('pointerdown', e => {
    state.dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('panel-resizing'); // disables text selection while dragging
  });
  handle.addEventListener('pointermove', e => {
    if (!state.dragging) return;
    setWidth(window.innerWidth - e.clientX);
  });
  const endDrag = e => {
    if (!state.dragging) return;
    state.dragging = false;
    document.body.classList.remove('panel-resizing');
    setWidth(window.innerWidth - e.clientX, { persist: true });
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => setWidth(initial, { persist: true }));
  handle.addEventListener('keydown', e => {
    // Handle sits on the panel's left edge: dragging it left widens the panel, so ArrowLeft
    // mirrors that direction (+16) and ArrowRight narrows it (-16).
    if (e.key === 'ArrowLeft') { setWidth(state.width + 16, { persist: true }); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setWidth(state.width - 16, { persist: true }); e.preventDefault(); }
  });
  window.addEventListener('resize', () => setWidth(state.width));
};
