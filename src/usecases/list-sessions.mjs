// listSessions(now) -> SessionView[]. Same output, same ordering, same filters (incl. hold seating,
// stale summary rule, diffStat for review/question) as the old buildSessions.
import fs from 'node:fs';
import { HOME, DAY, MAX_DESKS } from '../config.mjs';
import { loadAppSessions } from '../sources/app-sessions.mjs';
import { loadStates } from '../sources/hook-states.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import * as summaries from '../sources/summaries.mjs';
import { transcriptPathFor, lastAssistantText, firstPromptHead } from '../sources/transcripts.mjs';
import { gitInfo, mergeBase, shortstat, untrackedFiles, addedFilePatch } from '../sources/git.mjs';
import { countLines, isBinaryPatch } from '../domain/diff.mjs';
import { activeDecision, deriveStatus, seatAtDesks } from '../domain/status.mjs';
import { parseReport } from '../domain/report.mjs';
import { toSessionView } from '../domain/session-view.mjs';
import { todoIdIn } from '../domain/todo.mjs';

// New (untracked) files added to a tracked shortstat's counts, so a report that only created
// files (git diff ignores those) doesn't read as "변경 없음" on the card.
const addUntracked = (wt, stat) => {
    const files = untrackedFiles(wt);
    if (!files.length) return stat;
    const added = files.reduce((sum, f) => {
        const patch = addedFilePatch(wt, f);
        if (!patch || isBinaryPatch(patch)) return sum;
        return sum + countLines(patch).add;
    }, 0);
    return { files: stat.files + files.length, add: stat.add + added, del: stat.del };
};

// Diff shortstat for cards; cached per (session, event) so polling doesn't re-run git.
const statCache = new Map();
const statFor = (id, at, app) => {
    const wt = app?.worktreePath;
    if (!wt || !fs.existsSync(wt)) return null;
    const key = `${id}:${at}`;
    if (!statCache.has(key)) {
        try {
            const base = mergeBase(wt, app.sourceBranch || 'HEAD');
            const out = base ? shortstat(wt, base) : '';
            const n = re => Number((out.match(re) || [])[1] || 0);
            const stat = { files: n(/(\d+) files? changed/), add: n(/(\d+) insertions?/), del: n(/(\d+) deletions?/) };
            statCache.set(key, addUntracked(wt, stat));
        } catch {
            statCache.set(key, null);
        }
    }
    return statCache.get(key);
};

// Every app session and hook state as { cli, state, app, id, active, lastAt }: no 24h window, no desk cap.
// The board filters these; todo-links reads all of them (a todo's session may be days old or archived).
export const collectCandidates = ({ decisions, apps = loadAppSessions(), states = loadStates() }) => {
    const appByCli = new Map(apps.map(a => [a.cliSessionId, a]));
    const stateIds = new Set(states.map(s => s.id));
    const fromStates = states.map(state => ({ cli: state.id, state, app: appByCli.get(state.id) }));
    const appOnly = apps.filter(a => !stateIds.has(a.cliSessionId)).map(app => ({ cli: app.cliSessionId, state: null, app }));
    return [...fromStates, ...appOnly].map(({ cli, state, app }) => {
        const id = app?.sessionId || cli;
        const active = activeDecision(decisions[id], state);
        return { cli, state, app, id, active, lastAt: Math.max(state?.at || 0, app?.lastActivityAt || 0) };
    });
};

// The hook's transcript path, else the one the CLI derives from the cwd.
export const transcriptOf = ({ cli, state, app }) => {
    const cwd = app?.cwd || state?.cwd || '';
    return state?.transcriptPath || (cwd ? transcriptPathFor(cwd, cli) : '');
};

export const listSessions = (now = Date.now()) => {
    const apps = loadAppSessions();
    const states = loadStates();
    const decisions = decisionsStore.load();
    const overrides = overridesStore.load();
    const candidates = collectCandidates({ now, decisions, apps, states })
        // Held sessions stay on the board past the 24h window; archived ones leave it (see listArchived).
        .filter(s => (now - s.lastAt < DAY || s.active === 'hold') && s.active !== 'archive' && !s.app?.isArchived)
        .sort((a, b) => b.lastAt - a.lastAt);
    return seatAtDesks(candidates, MAX_DESKS).map(candidate => {
        const { cli, state, app, lastAt, active } = candidate;
        const cwd = app?.cwd || state?.cwd || '';
        const transcript = transcriptOf(candidate);
        const lastText = transcript ? lastAssistantText(transcript) : '';
        const report = parseReport(lastText);
        const id = app?.sessionId || cli;
        // A summary describes the turn it was made for; once the session moves on it is stale.
        const s = summaries.read(id);
        const summary = s && s.at >= (state?.at || 0) ? s.text : null;
        const status = deriveStatus({ state, hasReport: !!report, decision: decisions[id] });
        const baseStatus = deriveStatus({ state, hasReport: !!report, decision: null });
        const gi = gitInfo(cwd);
        const diffStat = ['review', 'question'].includes(status) ? statFor(id, state?.at, app) : null;
        const override = overrides[id];
        const view = toSessionView({ cli, state, app, lastAt, cwd, transcript, lastText, report, id, summary, status, baseStatus, gi, diffStat, home: HOME, override });
        // Additive fields: the todo this session was started for, and when the active lead decision was made.
        return { ...view, todoId: todoIdIn(firstPromptHead(transcript)), decidedAt: active ? decisions[id].at : null };
    });
};
