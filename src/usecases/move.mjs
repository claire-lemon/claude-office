// moveSession(session, to): a 결재함 card drop. Allowed targets come from session.moves (domain/board.mjs).
import * as decide from './decide.mjs';
import { resolveMove } from '../domain/board.mjs';

// One row per MOVE_RULES action. confirm only records the decision: no clipboard, no chat (the 컨펌 button does that).
const APPLY = {
    hold: s => decide.hold(s.id),
    confirm: s => decide.markConfirmed(s.id),
    undo: s => decide.undo(s.id),
    archive: s => decide.archive(s),
};

export const moveSession = (session, to) => {
    const move = resolveMove(session.moves, to);
    if (!move) return { error: 'move not allowed' };
    APPLY[move.action](session);
    return { ok: true, action: move.action };
};
