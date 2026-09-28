// git runner + read-only queries. No business decisions. Every query below returns null/[]/''
// on failure (missing dir, not a repo, no matching ref) instead of throwing -- callers decide
// what that means (docs/specs/2026-09-28-layering-and-panel-design.md §3.3).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const git = (cwd, args) =>
    execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

const tryGit = (cwd, args) => {
    try {
        return git(cwd, args);
    } catch {
        return null;
    }
};
const refExists = (cwd, ref) => tryGit(cwd, ['show-ref', '--verify', '--quiet', ref]) !== null;

// Project name (origin remote's repo name, else folder name) and current branch for a folder.
// ponytail: 10s cache per folder; branches rarely move faster than a human reads the board.
const gitInfoCache = new Map();
const GIT_INFO_TTL = 10000;
export const gitInfo = dir => {
    if (!dir || !fs.existsSync(dir)) return { project: null, branch: null };
    const hit = gitInfoCache.get(dir);
    if (hit && Date.now() - hit.at < GIT_INFO_TTL) return hit.info;
    const run = args => tryGit(dir, args)?.trim() || null;
    const remote = run(['remote', 'get-url', 'origin']);
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
    const info = {
        project: remote ? path.basename(remote).replace(/\.git$/, '') : path.basename(dir),
        branch: branch === 'HEAD' ? null : branch,
    };
    gitInfoCache.set(dir, { at: Date.now(), info });
    return info;
};

// Repo root for a folder that may not itself be a worktree (e.g. a session cwd inside a repo
// with no separate worktree). null when `dir` isn't inside a git repo at all.
export const repoRoot = dir => tryGit(dir, ['rev-parse', '--show-toplevel'])?.trim() || null;

export const currentBranch = dir => {
    const branch = tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
    return branch && branch !== 'HEAD' ? branch : null;
};

// origin/HEAD -> main -> master, whichever exists locally.
export const defaultBranch = dir => {
    const symbolic = tryGit(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim();
    if (symbolic) return symbolic.replace(/^origin\//, '');
    if (refExists(dir, 'refs/heads/main')) return 'main';
    if (refExists(dir, 'refs/heads/master')) return 'master';
    return null;
};

// Diff primitives that getChanges composes.
export const mergeBase = (dir, ref) => tryGit(dir, ['merge-base', ref, 'HEAD'])?.trim() || null;
export const shortstat = (dir, base) => tryGit(dir, ['diff', '--shortstat', base])?.trim() || '';
// Committed + working-tree diff against `base` (a rename of the old rawDiff to match the design doc).
export const trackedPatch = (dir, base) => tryGit(dir, ['diff', base]) || '';

// Never-added files, respecting .gitignore. -z avoids ambiguity from newlines/spaces in filenames.
export const untrackedFiles = dir => {
    const out = tryGit(dir, ['ls-files', '--others', '--exclude-standard', '-z']);
    return out ? out.split('\0').filter(Boolean) : [];
};

// A new file's full content as a patch, without touching the index (no `git add -N`: that would
// mutate the session's own staging area/status). `git diff --no-index` exits 1 when it finds a
// diff -- the expected outcome here, not an error -- so stdout is captured on that path too.
export const addedFilePatch = (dir, file) => {
    try {
        return git(dir, ['diff', '--no-index', '--', '/dev/null', file]);
    } catch (e) {
        return typeof e.stdout === 'string' && e.stdout ? e.stdout : null;
    }
};
