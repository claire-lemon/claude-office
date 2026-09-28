// linkIndex(boardSessions, now) -> Map<todoId, LinkedSession[]> (design §6.2): every session whose transcript
// head carries a #todo- marker, on the board or not. Board sessions reuse their full view; the rest get a
// lean one that never reads the transcript tail or git.
import path from 'node:path';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import { firstPromptHead } from '../sources/transcripts.mjs';
import { columnOf } from '../domain/board.mjs';
import { ANIMALS, hash } from '../domain/session-view.mjs';
import { todoIdIn, byRecent } from '../domain/todo.mjs';
import { collectCandidates, transcriptOf } from './list-sessions.mjs';

// branch/prs/report ride along for todoPrompt's "이전 세션" line (board sessions only).
const pick = s => ({
    id: s.id, title: s.title, animal: s.animal, status: s.status, column: s.column,
    lastAt: s.lastAt, decidedAt: s.decidedAt, branch: s.branch, prs: s.prs, report: s.report,
});

// Off the board = older than 24h, archived, or past the desk cap.
const LEAN_STATUS = { archive: 'archived', confirm: 'done' };
const lean = ({ cli, state, app, id, active, lastAt }, decisions, overrides) => {
    const status = LEAN_STATUS[active] || 'stale';
    return {
        id,
        title: overrides[id]?.title || app?.title || path.basename(app?.cwd || state?.cwd || '') || cli.slice(0, 8),
        animal: ANIMALS[hash(id) % ANIMALS.length],
        status,
        column: columnOf(status),
        lastAt,
        decidedAt: active ? decisions[id].at : null,
    };
};

export const linkIndex = (boardSessions, now = Date.now()) => {
    const onBoard = new Map(boardSessions.map(s => [s.id, s]));
    const decisions = decisionsStore.load();
    const overrides = overridesStore.load();
    const links = collectCandidates({ now, decisions })
        .map(c => ({ todoId: todoIdIn(firstPromptHead(transcriptOf(c))), c }))
        .filter(l => l.todoId)
        .map(({ todoId, c }) => ({ todoId, view: onBoard.has(c.id) ? pick(onBoard.get(c.id)) : lean(c, decisions, overrides) }));
    return new Map([...Map.groupBy(links, l => l.todoId)].map(([todoId, ls]) => [todoId, ls.map(l => l.view).sort(byRecent)]));
};
