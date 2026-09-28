import * as api from '../api.js';
import { state, drag, controls } from '../store.js';
import { MOVE_HINT, MOVE_TOAST } from './columns.js';
import { flashPanelError } from './toast.js';

// Card drag between 결재함 columns (docs/specs/2026-09-28-board-interactions-design.md §5.3), native
// HTML5 DnD. Works only off data-id / data-col and session.moves from the server, so it doesn't care
// how board.js renders. Keyboard users get the same moves from the panel buttons.
const over = { el: null };
const DROP_CLASSES = ['drop-ok', 'drop-no', 'drop-over'];

const elementOf = node => (node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
const colOf = node => elementOf(node)?.closest?.('.kan-col') ?? null;

const setOver = col => {
  if (over.el === col) return;
  over.el?.classList.remove('drop-over');
  over.el = col;
  col?.classList.add('drop-over');
};

export const mountBoardDnd = (columnsEl, { onEnd }) => {
  const cols = () => Array.from(columnsEl.querySelectorAll('.kan-col'));

  columnsEl.addEventListener('dragstart', e => {
    const card = elementOf(e.target).closest('.kan-card');
    const session = card && state.sessionsById.get(card.dataset.id);
    if (!session) return;
    drag.id = session.id;
    e.dataTransfer.setData('text/plain', session.id);
    e.dataTransfer.effectAllowed = 'move';
    const hints = new Map((session.moves || []).map(m => [m.to, MOVE_HINT[m.action] ?? '']));
    cols().forEach(col => {
      const id = col.dataset.col;
      col.classList.toggle('drop-ok', hints.has(id));
      col.classList.toggle('drop-no', !hints.has(id) && id !== session.column);
      if (hints.has(id)) col.dataset.hint = hints.get(id);
    });
  });

  columnsEl.addEventListener('dragover', e => {
    const col = colOf(e.target);
    setOver(drag.id && col?.classList.contains('drop-ok') ? col : null);
    if (!over.el) return; // no preventDefault = the browser shows "can't drop here"
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  // dragleave also fires when moving between a column's own children: only clear on a real exit.
  // (Where relatedTarget is null the next dragover, fired continuously, puts the highlight back.)
  columnsEl.addEventListener('dragleave', e => {
    if (over.el && !over.el.contains(elementOf(e.relatedTarget))) setOver(null);
  });

  columnsEl.addEventListener('drop', async e => {
    const col = over.el;
    const id = drag.id;
    const session = id && state.sessionsById.get(id);
    if (!col || !session) return;
    e.preventDefault();
    const to = col.dataset.col;
    // Optimistic: dragend re-renders right after this, before the move lands; without it the card
    // would flash back into its old column until the poll. The poll below corrects any mismatch.
    session.column = to;
    try {
      const res = await api.postMove(id, to);
      const data = await res.json().catch(() => ({}));
      flashPanelError(res.ok ? (MOVE_TOAST[data.action] ?? '옮겼어요') : res.status === 409 ? '여기로는 옮길 수 없어요' : '옮기지 못했어요');
    } catch {
      flashPanelError('옮기지 못했어요');
    }
    controls.poll();
  });

  // Fires on the source card after a drop or a cancel (Esc, dropped outside).
  columnsEl.addEventListener('dragend', () => {
    setOver(null);
    cols().forEach(col => { col.classList.remove(...DROP_CLASSES); delete col.dataset.hint; });
    drag.id = null;
    onEnd(); // renders were skipped during the drag
  });
};
