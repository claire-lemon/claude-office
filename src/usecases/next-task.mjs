// startNextTask(session, index): OK = start the recommended next task in a NEW session, prompt prefilled.
import fs from 'node:fs';
import { nextTaskPrompt, newSessionLink } from '../domain/prompts.mjs';
import { openUrl } from '../platform/macos.mjs';
import { markConfirmed } from './decide.mjs';

export const startNextTask = (session, index) => {
    const task = session.nextTasks[index];
    if (!task) return { error: 'no such next task' };
    const folder = session.originCwd || session.worktreePath;
    if (!folder || !fs.existsSync(folder)) return { error: 'repo folder not found' };
    const link = newSessionLink(folder, nextTaskPrompt(session, task));
    markConfirmed(session.id);
    openUrl(link);
    return { opened: link };
};
