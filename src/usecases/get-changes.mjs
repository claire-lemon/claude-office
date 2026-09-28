// getChanges(session) -> ChangesView. Same output as the old diffFor.
import fs from 'node:fs';
import { DIFF_LIMIT } from '../config.mjs';
import { mergeBase, shortstat, rawDiff, untrackedFiles } from '../sources/git.mjs';
import { splitPatch } from '../domain/diff.mjs';

export const getChanges = session => {
    const wt = session.worktreePath;
    if (!wt || !fs.existsSync(wt)) return { tracked: false };
    try {
        const base = mergeBase(wt, session.sourceBranch || 'HEAD');
        const stat = shortstat(wt, base);
        const raw = rawDiff(wt, base);
        const truncated = raw.length > DIFF_LIMIT;
        const files = splitPatch(truncated ? raw.slice(0, DIFF_LIMIT) : raw);
        const untracked = untrackedFiles(wt);
        return { tracked: true, stat, files, untracked, truncated };
    } catch (e) {
        return { tracked: true, error: String(e.message || e).split('\n')[0] };
    }
};
