import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const HOME = process.env.OFFICE_HOME || os.homedir();
export const APP_DIR =
    process.env.OFFICE_APP_DIR || path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions');
export const OFFICE_DIR = path.join(HOME, '.claude/office');
export const STATE_DIR = path.join(OFFICE_DIR, 'state');
export const CONFIRMED_FILE = path.join(OFFICE_DIR, 'confirmed.json');
export const SUMMARY_DIR = path.join(OFFICE_DIR, 'summaries');

const DAY = 24 * 60 * 60 * 1000;
const MAX_DESKS = 10;
const TAIL_BYTES = 256 * 1024;
const DIFF_LIMIT = 500 * 1024;
export const ANIMALS = ['cat', 'dog', 'rabbit', 'bear', 'penguin', 'fox', 'hamster', 'panda', 'duck', 'frog'];

export const readJson = (file, fallback = null) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
};

export const writeJsonAtomic = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
};

export const hash = (s = '') => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const listFiles = (dir, depth) => {
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return depth > 0 ? listFiles(p, depth - 1) : [];
            return [p];
        });
    } catch {
        return [];
    }
};

// ponytail: app layout is <uuid>/<uuid>/local_*.json; internal format, fail-soft if it moves.
const appCache = new Map();
export const loadAppSessions = () =>
    listFiles(APP_DIR, 2)
        .filter(f => path.basename(f).startsWith('local_') && f.endsWith('.json'))
        .map(f => {
            const mtime = fs.statSync(f).mtimeMs;
            const hit = appCache.get(f);
            if (hit && hit.mtime === mtime) return hit.data;
            const data = readJson(f);
            appCache.set(f, { mtime, data });
            return data;
        })
        .filter(s => s && s.cliSessionId);

export const loadStates = () =>
    listFiles(STATE_DIR, 0)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ id: path.basename(f, '.json'), ...readJson(f, {}) }))
        .filter(s => s.event && s.at);

export const transcriptPathFor = (cwd, cliSessionId) =>
    path.join(HOME, '.claude/projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), `${cliSessionId}.jsonl`);

export const lastAssistantText = file => {
    try {
        const fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - TAIL_BYTES);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n').reverse();
        const text = lines
            .map(l => {
                try {
                    return JSON.parse(l);
                } catch {
                    return null;
                }
            })
            .filter(d => d && d.type === 'assistant' && !d.isSidechain && Array.isArray(d.message?.content))
            .map(d => d.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n'))
            .find(t => t.trim());
        return text || '';
    } catch {
        return '';
    }
};

export const parseReport = text => {
    const idx = text.search(/^## 결재 보고\s*$/m);
    if (idx < 0) return null;
    const body = text.slice(idx).split('\n').slice(1).join('\n');
    const end = body.search(/^## /m);
    const block = end < 0 ? body : body.slice(0, end);
    return Object.fromEntries(
        block
            .split(/^### /m)
            .slice(1)
            .map(sec => {
                const [head, ...rest] = sec.split('\n');
                return [head.trim(), rest.join('\n').trim()];
            }),
    );
};

export const deriveStatus = ({ state, hasReport, confirmedAt }) => {
    if (!state) return 'unknown';
    if (confirmedAt && confirmedAt > state.at) return 'done';
    if (state.event === 'UserPromptSubmit') return 'working';
    if (state.event === 'Notification') return 'blocked';
    if (state.event === 'Stop') return hasReport ? 'review' : 'question';
    return 'unknown';
};

export const buildSessions = (now = Date.now()) => {
    const apps = loadAppSessions();
    const states = loadStates();
    const confirmed = readJson(CONFIRMED_FILE, {});
    const appByCli = new Map(apps.map(a => [a.cliSessionId, a]));
    const stateIds = new Set(states.map(s => s.id));
    const fromStates = states.map(state => ({ cli: state.id, state, app: appByCli.get(state.id) }));
    const appOnly = apps
        .filter(a => !stateIds.has(a.cliSessionId) && now - (a.lastActivityAt || 0) < DAY)
        .map(app => ({ cli: app.cliSessionId, state: null, app }));
    return [...fromStates, ...appOnly]
        .map(({ cli, state, app }) => ({ cli, state, app, lastAt: Math.max(state?.at || 0, app?.lastActivityAt || 0) }))
        .filter(s => now - s.lastAt < DAY && !s.app?.isArchived)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, MAX_DESKS)
        .map(({ cli, state, app, lastAt }) => {
            const cwd = app?.cwd || state?.cwd || '';
            const transcript = state?.transcriptPath || (cwd ? transcriptPathFor(cwd, cli) : '');
            const lastText = transcript ? lastAssistantText(transcript) : '';
            const report = parseReport(lastText);
            const id = app?.sessionId || cli;
            const summary = fs.existsSync(path.join(SUMMARY_DIR, `${id}.md`))
                ? fs.readFileSync(path.join(SUMMARY_DIR, `${id}.md`), 'utf8')
                : null;
            const status = deriveStatus({ state, hasReport: !!report, confirmedAt: confirmed[id] });
            return {
                id,
                cli,
                title: app?.title || path.basename(cwd) || cli.slice(0, 8),
                animal: ANIMALS[hash(id) % ANIMALS.length],
                repo: path.basename(app?.originCwd || cwd),
                repoHue: hash(app?.originCwd || cwd) % 360,
                status,
                event: state?.event || null,
                eventAt: state?.at || null,
                message: state?.message || null,
                lastAt,
                branch: app?.branch || null,
                sourceBranch: app?.sourceBranch || null,
                worktreePath: app?.worktreePath || null,
                prs: (app?.prs || []).map(p => ({ number: p.number, state: p.state, url: p.url })),
                turns: app?.completedTurns ?? null,
                link: app?.sessionId ? `claude://claude.ai/epitaxy/${app.sessionId}` : null,
                transcript,
                report,
                summary,
                diffStat: ['review', 'question'].includes(status) ? statFor(id, state?.at, app) : null,
                preview: report ? null : lastText.slice(0, 300),
            };
        });
};

// Diff shortstat for cards; cached per (session, event) so polling doesn't re-run git.
const statCache = new Map();
const statFor = (id, at, app) => {
    const wt = app?.worktreePath;
    if (!wt || !fs.existsSync(wt)) return null;
    const key = `${id}:${at}`;
    if (!statCache.has(key)) {
        try {
            const base = git(wt, ['merge-base', app.sourceBranch || 'HEAD', 'HEAD']).trim();
            const out = git(wt, ['diff', '--shortstat', base]);
            const n = re => Number((out.match(re) || [])[1] || 0);
            statCache.set(key, { files: n(/(\d+) files? changed/), add: n(/(\d+) insertions?/), del: n(/(\d+) deletions?/) });
        } catch {
            statCache.set(key, null);
        }
    }
    return statCache.get(key);
};

const git = (cwd, args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 });

export const diffFor = session => {
    const wt = session.worktreePath;
    if (!wt || !fs.existsSync(wt)) return { tracked: false };
    try {
        const base = git(wt, ['merge-base', session.sourceBranch || 'HEAD', 'HEAD']).trim();
        const stat = git(wt, ['diff', '--shortstat', base]).trim();
        const raw = git(wt, ['diff', base]);
        const truncated = raw.length > DIFF_LIMIT;
        const files = (truncated ? raw.slice(0, DIFF_LIMIT) : raw)
            .split(/^diff --git /m)
            .filter(Boolean)
            .map(chunk => ({ path: chunk.split('\n')[0].split(' b/').pop(), patch: `diff --git ${chunk}` }));
        const untracked = git(wt, ['status', '--porcelain'])
            .split('\n')
            .filter(l => l.startsWith('??'))
            .map(l => l.slice(3));
        return { tracked: true, stat, files, untracked, truncated };
    } catch (e) {
        return { tracked: true, error: String(e.message || e).split('\n')[0] };
    }
};
