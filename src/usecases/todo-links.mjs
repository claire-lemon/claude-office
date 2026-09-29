// linkIndex(boardSessions, now) -> Map<todoId, LinkedSession[]> (design §6.2): every session whose transcript
// head carries a #todo- marker or that a todo assigned by hand (finishing design §4), on the board or not.
// Board sessions reuse their full view; the rest get a lean one that never reads the transcript tail or git.
// Links seen once are kept in links.json (todo-history design §3.1), so a todo keeps its sessions after their
// transcripts are cleaned up.
import path from 'node:path';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import * as linksStore from '../sources/links.mjs';
import * as todosStore from '../sources/todos.mjs';
import { firstPromptHead } from '../sources/transcripts.mjs';
import { columnOf } from '../domain/board.mjs';
import { ANIMALS, hash } from '../domain/session-view.mjs';
import { todoIdIn, assignedTo, linkChanges, mergeLinks } from '../domain/todo.mjs';
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

// The snapshot is a nice-to-have: a read-only home must not break GET /api/todos (live links still answer).
const saveChanges = changes => {
    try {
        linksStore.saveMany(changes);
    } catch (e) {
        console.error(`links.json not written: ${e.message}`);
    }
};

// 배정 해제: the snapshot goes too, or mergeLinks would bring the session back as a 지난 세션.
export const forgetLinks = ids => {
    try {
        linksStore.remove(ids);
    } catch (e) {
        console.error(`links.json not written: ${e.message}`);
    }
};

export const linkIndex = (boardSessions, now = Date.now()) => {
    const onBoard = new Map(boardSessions.map(s => [s.id, s]));
    const decisions = decisionsStore.load();
    const overrides = overridesStore.load();
    const todos = todosStore.load();
    // A marker link wins over an assignment (updateTodo never lets both happen). Deleted todos keep theirs.
    const live = collectCandidates({ now, decisions })
        .map(c => {
            const marker = todoIdIn(firstPromptHead(transcriptOf(c)));
            return { todoId: marker ?? assignedTo(todos, c.id), via: marker ? 'marker' : 'assigned', c };
        })
        .filter(l => l.todoId)
        .map(({ todoId, via, c }) => ({ todoId, view: { ...(onBoard.has(c.id) ? pick(onBoard.get(c.id)) : lean(c, decisions, overrides)), via } }));
    const stored = linksStore.load();
    const changes = linkChanges(stored, live, now);
    if (Object.keys(changes).length) saveChanges(changes);
    return mergeLinks({ ...stored, ...changes }, live);
};
