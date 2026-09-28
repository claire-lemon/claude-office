// Pure 결재함 rules: which column a status sits in and where a card may be dropped. The server computes
// both (session.column / session.moves) so the board and the API can never disagree.

// status -> column; null = not on the board (unknown, archived)
export const COLUMN_OF = { working: 'working', review: 'pending', question: 'pending', blocked: 'pending', hold: 'hold', done: 'done' };
export const columnOf = status => COLUMN_OF[status] ?? null;

// One row per drop rule. 'base' = the column the session would be in without the lead decision.
// working -> done is left out on purpose: the next hook event would pull the card straight back.
export const MOVE_RULES = [
    { to: 'hold', action: 'hold', from: ['working', 'pending', 'done'] },
    { to: 'done', action: 'confirm', from: ['pending', 'hold'] },
    { to: 'base', action: 'undo', from: ['hold', 'done'] },
    // Not a column: the header's 🗄️ 보관함 button. Any card on the board can be archived.
    { to: 'archive', action: 'archive', from: ['working', 'pending', 'hold', 'done'] },
];

export const movesFor = ({ status, baseStatus }) => {
    const from = columnOf(status);
    return MOVE_RULES.filter(r => r.from.includes(from))
        .map(r => ({ to: r.to === 'base' ? columnOf(baseStatus) : r.to, action: r.action }))
        .filter(m => m.to && m.to !== from);
};

export const resolveMove = (moves, to) => moves.find(m => m.to === to) ?? null;
