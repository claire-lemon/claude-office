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
export const DECISIONS_FILE = path.join(OFFICE_DIR, 'decisions.json');

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

const tilde = p => (p && (p === HOME || p.startsWith(`${HOME}/`)) ? `~${p.slice(HOME.length)}` : p);

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

// "### 다음 작업" numbered items -> [{ title, detail }]; indented lines become the item's detail.
export const parseTasks = text =>
    String(text || '')
        .split('\n')
        .reduce((acc, line) => {
            const top = line.match(/^(?:\d+[.)]|[-*])\s+(.*)$/);
            if (top) return [...acc, { title: top[1].trim(), detail: [] }];
            if (acc.length && line.trim()) acc[acc.length - 1].detail.push(line.trim().replace(/^(?:\d+[.)]|[-*])\s+/, ''));
            return acc;
        }, [])
        .map(t => ({ title: t.title, detail: t.detail.join('\n') }));

export const CONFIRM_INSTRUCTION = `결재 승인. 아래 순서로 진행해줘.
1. 변경사항 커밋 (이 레포의 커밋 메시지 규칙 준수, 변경이 없으면 생략)
2. push 후 PR 생성 (이미 PR이 있으면 갱신)
3. 결재 보고로 마무리
   1. 한 줄 요약에 PR 링크 포함
   2. \`### 다음 작업\` 섹션에 이어서 할 작업 2~3개 추천 (1번이 가장 추천, 각 항목 아래 들여쓴 하위 항목으로 이유)`;

const NEXT_PROMPT_LIMIT = 2000;
export const nextTaskPrompt = (session, task) => {
    const pr = (session.prs || []).map(p => p.url).filter(Boolean)[0];
    const summary = session.report?.['한 줄 요약'] || '';
    const text = [
        `이전 세션 "${session.title}"에서 이어지는 작업이야.`,
        `- 이전 브랜치: ${session.branch || '없음'}${pr ? `, PR: ${pr}` : ''}`,
        summary && `- 이전 작업 요약:\n${summary}`,
        '',
        `할 일: ${task.title}`,
        task.detail && task.detail,
    ]
        .filter(l => l !== false && l !== null && l !== undefined)
        .join('\n');
    return text.slice(0, NEXT_PROMPT_LIMIT);
};

export const newSessionLink = (folder, prompt) =>
    `claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(folder)}`;

// A session carries at most one lead decision: confirm | hold | archive. It applies until a newer hook event
// (e.g. the user sends another prompt), so resumed work always comes back on its own.
// confirmed.json is the pre-decisions format; still read so old confirms keep working.
export const loadDecisions = () => ({
    ...Object.fromEntries(Object.entries(readJson(CONFIRMED_FILE, {})).map(([id, at]) => [id, { kind: 'confirm', at }])),
    ...readJson(DECISIONS_FILE, {}),
});
export const saveDecision = (id, decision) => writeJsonAtomic(DECISIONS_FILE, { ...readJson(DECISIONS_FILE, {}), [id]: decision });
export const clearDecision = id => {
    const { [id]: _d, ...decisions } = readJson(DECISIONS_FILE, {});
    const { [id]: _c, ...confirmed } = readJson(CONFIRMED_FILE, {});
    writeJsonAtomic(DECISIONS_FILE, decisions);
    writeJsonAtomic(CONFIRMED_FILE, confirmed);
};
export const activeDecision = (decision, state) => (decision && decision.at > (state?.at || 0) ? decision.kind : null);

const DECISION_STATUS = { confirm: 'done', hold: 'hold', archive: 'archived' };
export const deriveStatus = ({ state, hasReport, decision }) => {
    const active = activeDecision(decision, state);
    if (active) return DECISION_STATUS[active];
    if (!state) return 'unknown';
    if (state.event === 'UserPromptSubmit') return 'working';
    if (state.event === 'Notification') return 'blocked';
    if (state.event === 'Stop') return hasReport ? 'review' : 'question';
    return 'unknown';
};

// One line for the archive list: the report's 한 줄 요약, else the start of the last reply.
export const oneLineSummary = session =>
    String(session.report?.['한 줄 요약'] || session.preview || session.lastMessage || '')
        .split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
        .find(Boolean)
        ?.slice(0, 160) || '';

// Archived sessions still archived (no newer activity), newest first.
export const listArchived = () => {
    const apps = loadAppSessions();
    const byCli = new Map(apps.map(a => [a.cliSessionId, a.sessionId]));
    const stateById = new Map(loadStates().map(st => [byCli.get(st.id) || st.id, st]));
    return Object.entries(loadDecisions())
        .filter(([id, d]) => d.kind === 'archive' && activeDecision(d, stateById.get(id)) === 'archive')
        .map(([id, d]) => ({ id, title: d.title || id, archivedAt: d.at, lastAt: d.lastAt || null, summary: d.summary || '' }))
        .sort((a, b) => b.archivedAt - a.archivedAt);
};

export const buildSessions = (now = Date.now()) => {
    const apps = loadAppSessions();
    const states = loadStates();
    const decisions = loadDecisions();
    const appByCli = new Map(apps.map(a => [a.cliSessionId, a]));
    const stateIds = new Set(states.map(s => s.id));
    const fromStates = states.map(state => ({ cli: state.id, state, app: appByCli.get(state.id) }));
    const appOnly = apps.filter(a => !stateIds.has(a.cliSessionId)).map(app => ({ cli: app.cliSessionId, state: null, app }));
    return [...fromStates, ...appOnly]
        .map(({ cli, state, app }) => {
            const id = app?.sessionId || cli;
            const active = activeDecision(decisions[id], state);
            return { cli, state, app, id, active, lastAt: Math.max(state?.at || 0, app?.lastActivityAt || 0) };
        })
        // Held sessions stay on the board past the 24h window; archived ones leave it (see listArchived).
        .filter(s => (now - s.lastAt < DAY || s.active === 'hold') && s.active !== 'archive' && !s.app?.isArchived)
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
            const status = deriveStatus({ state, hasReport: !!report, decision: decisions[id] });
            const gi = cwd && fs.existsSync(cwd) ? gitInfo(cwd) : { project: null, branch: null };
            return {
                id,
                cli,
                title: app?.title || path.basename(cwd) || cli.slice(0, 8),
                animal: ANIMALS[hash(id) % ANIMALS.length],
                repo: gi.project || path.basename(app?.originCwd || cwd),
                repoHue: hash(app?.originCwd || cwd) % 360,
                status,
                event: state?.event || null,
                eventAt: state?.at || null,
                message: state?.message || null,
                lastAt,
                branch: app?.branch || gi.branch,
                sourceBranch: app?.sourceBranch || null,
                originCwd: app?.originCwd || null,
                projectPath: tilde(app?.originCwd || cwd) || null,
                cwd: tilde(cwd) || null,
                nextTasks: parseTasks(report?.['다음 작업']),
                worktreePath: app?.worktreePath || null,
                prs: (app?.prs || []).map(p => ({ number: p.number, state: p.state, url: p.url })),
                turns: app?.completedTurns ?? null,
                link: app?.sessionId ? `claude://claude.ai/epitaxy/${app.sessionId}` : null,
                transcript,
                report,
                summary,
                diffStat: ['review', 'question'].includes(status) ? statFor(id, state?.at, app) : null,
                preview: report ? null : lastText.slice(0, 300),
                lastMessage: lastText.slice(0, 20000),
            };
        });
};

// Project name (origin remote's repo name, else folder name) and current branch for a folder.
// ponytail: 10s cache per folder; branches rarely move faster than a human reads the board.
const gitInfoCache = new Map();
const GIT_INFO_TTL = 10000;
export const gitInfo = dir => {
    if (!dir) return { project: null, branch: null };
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
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

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
