// getChanges(session) -> ChangesView (docs/specs/2026-09-28-layering-and-panel-design.md §4.2).
import fs from 'node:fs';
import path from 'node:path';
import { HOME, DIFF_FILE_LIMIT, DIFF_TOTAL_LIMIT, DIFF_MAX_UNTRACKED } from '../config.mjs';
import {
    repoRoot,
    currentBranch,
    defaultBranch,
    mergeBase,
    shortstat,
    trackedPatch,
    untrackedFiles,
    addedFilePatch,
} from '../sources/git.mjs';
import { splitPatch, countLines, isBinaryPatch } from '../domain/diff.mjs';

// session.cwd is tilde-abbreviated for display (see domain/session-view.mjs); reverse that here
// since git/fs need the real absolute path. Lossless: tilde() only ever replaces an exact HOME
// prefix, so this is its exact inverse.
const untilde = p => (typeof p === 'string' && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// worktreePath -> repoRoot(cwd) -> unusable. `cwd` covers a session opened directly in a repo
// with no separate worktree (the "변경 추적 불가" case §2 measured).
const resolveFolder = session => {
    if (session.worktreePath && fs.existsSync(session.worktreePath)) return { folder: session.worktreePath };
    const cwd = untilde(session.cwd) || session.originCwd || null;
    if (!cwd || !fs.existsSync(cwd)) return { folder: null, reason: 'no-folder' };
    const root = repoRoot(cwd);
    return root ? { folder: root } : { folder: null, reason: 'not-git' };
};

// session.sourceBranch (if it still exists) -> defaultBranch() -> HEAD-only (already on default,
// so only uncommitted changes are meaningful) -- §6.1.
const resolveBase = (dir, sourceBranch) => {
    const sessionMb = sourceBranch && mergeBase(dir, sourceBranch);
    if (sessionMb) return { ref: sourceBranch, source: 'session', mb: sessionMb };
    const def = defaultBranch(dir);
    const onDefault = !!def && currentBranch(dir) === def;
    if (def && !onDefault) {
        const mb = mergeBase(dir, def);
        if (mb) return { ref: def, source: 'default', mb };
    }
    return { ref: def || 'HEAD', source: 'head', mb: mergeBase(dir, 'HEAD') };
};

const overSize = patch => Buffer.byteLength(patch, 'utf8') > DIFF_FILE_LIMIT;

// Untracked files each become a whole-file "added" patch (no `git add -N`, see sources/git.mjs).
const untrackedChanges = (dir, files) =>
    files.slice(0, DIFF_MAX_UNTRACKED).map(file => {
        const size = fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.size ?? 0;
        if (size > DIFF_FILE_LIMIT) return { path: file, patch: '', status: 'added', untracked: true, add: 0, del: 0, binary: false, tooLarge: true };
        const patch = addedFilePatch(dir, file) || '';
        const binary = isBinaryPatch(patch);
        const { add, del } = binary ? { add: 0, del: 0 } : countLines(patch);
        return { path: file, patch: binary ? '' : patch, status: 'added', untracked: true, add, del, binary, tooLarge: false };
    });

// Total patch bytes across all files are capped; once the budget is spent, later files keep
// their path/status/counts but lose their patch text (the caller sets truncated:true).
const capTotalBytes = files => {
    const budget = { left: DIFF_TOTAL_LIMIT, hit: false };
    const capped = files.map(f => {
        if (!f.patch) return f;
        const bytes = Buffer.byteLength(f.patch, 'utf8');
        if (bytes > budget.left) {
            budget.hit = true;
            return { ...f, patch: '' };
        }
        budget.left -= bytes;
        return f;
    });
    return { files: capped, hitBudget: budget.hit };
};

export const getChanges = session => {
    const { folder, reason } = resolveFolder(session);
    if (!folder) return { tracked: false, reason };
    try {
        const base = resolveBase(folder, session.sourceBranch);
        const stat = base.mb ? shortstat(folder, base.mb) : '';
        const trackedFiles = (base.mb ? splitPatch(trackedPatch(folder, base.mb)) : []).map(f => ({
            ...f,
            untracked: false,
            tooLarge: overSize(f.patch),
            patch: overSize(f.patch) ? '' : f.patch,
        }));
        const allUntracked = untrackedFiles(folder);
        const newFiles = untrackedChanges(folder, allUntracked);
        const { files, hitBudget } = capTotalBytes([...trackedFiles, ...newFiles]);
        const totals = files.reduce(
            (t, f) => ({ files: t.files + 1, add: t.add + f.add, del: t.del + f.del, added: t.added + (f.status === 'added' ? 1 : 0) }),
            { files: 0, add: 0, del: 0, added: 0 },
        );
        const truncated = hitBudget || allUntracked.length > DIFF_MAX_UNTRACKED;
        // Both false together happens whenever there are zero files: base==HEAD (no committed
        // delta, since trackedPatch(base) would otherwise show it) and the tree is clean.
        const empty = files.length === 0 ? { committed: false, uncommitted: false } : undefined;
        return { tracked: true, base: { ref: base.ref, source: base.source }, stat, totals, files, untracked: allUntracked, truncated, empty };
    } catch (e) {
        return { tracked: true, reason: 'error', error: String(e.message || e).split('\n')[0] };
    }
};
