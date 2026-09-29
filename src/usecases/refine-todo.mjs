// ✨ 다듬기 (finishing design §3.1): the model rewrites a 칠판 할 일 into the work order a new session gets through
// [시작], from the todo, its recent sessions and today's 어제 이야기. Nothing is saved: the 칠판 shows it as a
// suggestion and the user applies it through the normal detail edit.
import * as notes from '../sources/daily-notes.mjs';
import { localDate, narrativeOf } from '../domain/daily-note.mjs';
import { REFINE_SYSTEM, refineInput, cleanRefined } from '../domain/prompts.mjs';
import { runSummarizer } from '../platform/claude-cli.mjs';
import { todoView } from './todos.mjs';

const REFINE_TIMEOUT = 90000;

// -> { detail } | { error: 'unknown todo' | 'refine failed' }; a failed model call rejects.
export const refineTodo = async (id, now = Date.now(), run = runSummarizer) => {
    const todo = todoView(id, now);
    if (!todo || todo.deletedAt) return { error: 'unknown todo' };
    const date = localDate(now);
    const input = refineInput({ todo, sessions: todo.sessions, narrative: narrativeOf(notes.read(date), date).text });
    const detail = cleanRefined(await run(input, REFINE_SYSTEM, REFINE_TIMEOUT));
    return detail ? { detail } : { error: 'refine failed' };
};
