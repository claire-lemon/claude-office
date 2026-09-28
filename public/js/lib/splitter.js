// Shared resize handle (docs/specs/2026-09-28-board-interactions-design.md §5.2.4). Delta-based:
// callers remember their start value in onStart and apply start + delta in onMove, so one helper
// serves the panel width, the office height and the kanban column widths. Imports nothing.
const KEYS = { x: { ArrowLeft: -1, ArrowRight: 1 }, y: { ArrowUp: -1, ArrowDown: 1 } };

export const mountSplitter = (handle, { axis = 'x', label = '크기 조정', step = 16, onStart = () => {}, onMove = () => {}, onEnd = () => {}, onReset = () => {} } = {}) => {
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal'); // a vertical bar resizes along x
  if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');
  handle.title = label;

  const drag = { pointerId: null, origin: 0 };
  const pos = e => (axis === 'x' ? e.clientX : e.clientY);

  handle.addEventListener('pointerdown', e => {
    drag.pointerId = e.pointerId;
    drag.origin = pos(e);
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing'); // base.css: no text selection while dragging
    onStart();
  });
  handle.addEventListener('pointermove', e => {
    if (e.pointerId === drag.pointerId) onMove(pos(e) - drag.origin);
  });
  const endDrag = e => {
    if (e.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    document.body.classList.remove('resizing');
    onEnd();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => onReset());
  handle.addEventListener('keydown', e => {
    const dir = KEYS[axis][e.key];
    if (!dir) return;
    e.preventDefault();
    onStart();
    onMove(dir * step);
    onEnd();
  });
};
