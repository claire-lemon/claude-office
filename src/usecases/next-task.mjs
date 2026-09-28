// startNextTask(session, index): OK = start the recommended next task in a NEW session, prompt prefilled.
import fs from 'node:fs';
import * as todosStore from '../sources/todos.mjs';
import { nextTaskPrompt, newSessionLink, NEXT_PROMPT_LIMIT } from '../domain/prompts.mjs';
import { markerLine } from '../domain/todo.mjs';
import { openUrl } from '../platform/macos.mjs';
import { markConfirmed } from './decide.mjs';

// A session started from a todo hands its #todo- marker on, so the follow-up session joins the same todo.
const promptFor = (session, task) => {
    const prompt = nextTaskPrompt(session, task);
    if (!session.todoId) return prompt;
    const title = todosStore.load()[session.todoId]?.title || session.title;
    return `${markerLine(session.todoId, title)}\n\n${prompt}`.slice(0, NEXT_PROMPT_LIMIT);
};

export const startNextTask = (session, index) => {
    const task = session.nextTasks[index];
    if (!task) return { error: 'no such next task' };
    const folder = session.originCwd || session.worktreePath;
    if (!folder || !fs.existsSync(folder)) return { error: 'repo folder not found' };
    const link = newSessionLink(folder, promptFor(session, task));
    markConfirmed(session.id);
    openUrl(link);
    return { opened: link };
};
