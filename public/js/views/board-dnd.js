import * as api from '../api.js';
import { state, drag, selected, controls } from '../store.js';
import { MOVE_HINT, MOVE_TOAST } from './columns.js';
import { flashPanelError } from './toast.js';

// Card drag (docs/specs/2026-09-28-board-interactions-design.md §5.3), native HTML5 DnD. A drop
// target is any element with data-drop="<move to>": the 결재함 columns and the header's 🗄️ 보관함
// button. Where a card may go comes from session.moves (server), so a new target is one data-drop
// attribute plus one server rule. Keyboard users get the same moves from the panel buttons.
const over = { el: null };
const DROP_CLASSES = ['drop-ok', 'drop-no', 'drop-over'];

const elementOf = node => (node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
const targetOf = node => elementOf(node)?.closest?.('[data-drop]') ?? null;
const targets = () => Array.from(document.querySelectorAll('[data-drop]'));

const setOver = el => {
  if (over.el === el) return;
  over.el?.classList.remove('drop-over');
  over.el = el;
  el?.classList.add('drop-over');
};

export const mountBoardDnd = (columnsEl, { onEnd }) => {
  columnsEl.addEventListener('dragstart', e => {
    const card = elementOf(e.target).closest('.kan-card');
    const session = card && state.sessionsById.get(card.dataset.id);
    if (!session) return;
    drag.id = session.id;
    e.dataTransfer.setData('text/plain', session.id);
    e.dataTransfer.effectAllowed = 'move';
    const hints = new Map((session.moves || []).map(m => [m.to, MOVE_HINT[m.action] ?? '']));
    targets().forEach(t => {
      const id = t.dataset.drop;
      t.classList.toggle('drop-ok', hints.has(id));
      t.classList.toggle('drop-no', !hints.has(id) && id !== session.column);
      if (hints.has(id)) t.dataset.hint = hints.get(id);
    });
  });

  // dragover/dragleave/drop on the document: targets live outside the board too (header button).
  document.addEventListener('dragover', e => {
    if (!drag.id) return;
    const t = targetOf(e.target);
    setOver(t?.classList.contains('drop-ok') ? t : null);
    if (!over.el) return; // no preventDefault = the browser shows "can't drop here"
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  // dragleave also fires when moving between a target's own children: only clear on a real exit.
  // (Where relatedTarget is null the next dragover, fired continuously, puts the highlight back.)
  document.addEventListener('dragleave', e => {
    if (over.el && !over.el.contains(elementOf(e.relatedTarget))) setOver(null);
  });

  document.addEventListener('drop', async e => {
    const target = over.el;
    const id = drag.id;
    const session = id && state.sessionsById.get(id);
    if (!target || !session) return;
    e.preventDefault();
    const to = target.dataset.drop;
    // Optimistic: dragend re-renders right after this, before the move lands; without it the card
    // would flash back into its old column until the poll ('archive' matches no column, so the card
    // just leaves the board). The poll below corrects any mismatch.
    session.column = to;
    try {
      const res = await api.postMove(id, to);
      const data = await res.json().catch(() => ({}));
      flashPanelError(res.ok ? (MOVE_TOAST[data.action] ?? '옮겼어요') : res.status === 409 ? '여기로는 옮길 수 없어요' : '옮기지 못했어요');
      if (res.ok && data.action === 'archive' && selected.id === id) controls.closePanel(); // same as the 아카이브 button
    } catch {
      flashPanelError('옮기지 못했어요');
    }
    controls.poll();
  });

  // Fires on the source card after a drop or a cancel (Esc, dropped outside).
  columnsEl.addEventListener('dragend', () => {
    setOver(null);
    targets().forEach(t => { t.classList.remove(...DROP_CLASSES); delete t.dataset.hint; });
    drag.id = null;
    onEnd(); // renders were skipped during the drag
  });
};
