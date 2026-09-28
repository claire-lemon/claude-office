// Panel width resize handle (docs/specs/2026-09-28-layering-and-panel-design.md §6.3), built on the
// shared lib/splitter.js. clampWidth is pure (no DOM access at module top level) so it's importable from Node tests.
import { loadPanelWidth, savePanelWidth } from '../lib/storage.js';
import { mountSplitter } from '../lib/splitter.js';

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

  // Mutable UI state kept in one const object (no let/var per project style).
  const state = { width: initial, start: initial };

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

  // Handle sits on the panel's left edge: moving it left (negative delta) widens the panel, so
  // ArrowLeft widens by one step and ArrowRight narrows, mirroring the drag direction.
  mountSplitter(handle, {
    axis: 'x',
    onStart: () => {
      state.start = state.width;
      document.body.classList.add('panel-resizing'); // panel.css: ew-resize cursor while dragging
    },
    onMove: dx => setWidth(state.start - dx),
    onEnd: () => {
      document.body.classList.remove('panel-resizing');
      setWidth(state.width, { persist: true });
    },
    onReset: () => setWidth(initial, { persist: true }),
  });
  window.addEventListener('resize', () => setWidth(state.width));
};
