// git runner + read-only queries. No business decisions.
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

// Project name (origin remote's repo name, else folder name) and current branch for a folder.
// ponytail: 10s cache per folder; branches rarely move faster than a human reads the board.
const gitInfoCache = new Map();
const GIT_INFO_TTL = 10000;
export const gitInfo = dir => {
    if (!dir || !fs.existsSync(dir)) return { project: null, branch: null };
    const hit = gitInfoCache.get(dir);
    if (hit && Date.now() - hit.at < GIT_INFO_TTL) return hit.info;
    const run = args => {
        try {
            return git(dir, args).trim() || null;
        } catch {
            return null;
        }
    };
    const remote = run(['remote', 'get-url', 'origin']);
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
    const info = {
        project: remote ? path.basename(remote).replace(/\.git$/, '') : path.basename(dir),
        branch: branch === 'HEAD' ? null : branch,
    };
    gitInfoCache.set(dir, { at: Date.now(), info });
    return info;
};

// Diff primitives that getChanges (formerly diffFor) composes.
export const mergeBase = (dir, ref) => git(dir, ['merge-base', ref, 'HEAD']).trim();
export const shortstat = (dir, base) => git(dir, ['diff', '--shortstat', base]).trim();
export const rawDiff = (dir, base) => git(dir, ['diff', base]);
export const untrackedFiles = dir =>
    git(dir, ['status', '--porcelain'])
        .split('\n')
        .filter(l => l.startsWith('??'))
        .map(l => l.slice(3));
