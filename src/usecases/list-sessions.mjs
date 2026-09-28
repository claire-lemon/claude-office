// listSessions(now) -> SessionView[]. Same output, same ordering, same filters (incl. hold seating,
// stale summary rule, diffStat for review/question) as the old buildSessions.
import fs from 'node:fs';
import { HOME, DAY, MAX_DESKS } from '../config.mjs';
import { loadAppSessions } from '../sources/app-sessions.mjs';
import { loadStates } from '../sources/hook-states.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import * as summaries from '../sources/summaries.mjs';
import { transcriptPathFor, lastAssistantText } from '../sources/transcripts.mjs';
import { gitInfo, mergeBase, shortstat } from '../sources/git.mjs';
import { activeDecision, deriveStatus, seatAtDesks } from '../domain/status.mjs';
import { parseReport } from '../domain/report.mjs';
import { toSessionView } from '../domain/session-view.mjs';

// Diff shortstat for cards; cached per (session, event) so polling doesn't re-run git.
const statCache = new Map();
const statFor = (id, at, app) => {
    const wt = app?.worktreePath;
    if (!wt || !fs.existsSync(wt)) return null;
    const key = `${id}:${at}`;
    if (!statCache.has(key)) {
        try {
            const base = mergeBase(wt, app.sourceBranch || 'HEAD');
            const out = shortstat(wt, base);
            const n = re => Number((out.match(re) || [])[1] || 0);
            statCache.set(key, { files: n(/(\d+) files? changed/), add: n(/(\d+) insertions?/), del: n(/(\d+) deletions?/) });
        } catch {
            statCache.set(key, null);
        }
    }
    return statCache.get(key);
};

export const listSessions = (now = Date.now()) => {
    const apps = loadAppSessions();
    const states = loadStates();
    const decisions = decisionsStore.load();
    const appByCli = new Map(apps.map(a => [a.cliSessionId, a]));
    const stateIds = new Set(states.map(s => s.id));
    const fromStates = states.map(state => ({ cli: state.id, state, app: appByCli.get(state.id) }));
    const appOnly = apps.filter(a => !stateIds.has(a.cliSessionId)).map(app => ({ cli: app.cliSessionId, state: null, app }));
    const candidates = [...fromStates, ...appOnly]
        .map(({ cli, state, app }) => {
            const id = app?.sessionId || cli;
            const active = activeDecision(decisions[id], state);
            return { cli, state, app, id, active, lastAt: Math.max(state?.at || 0, app?.lastActivityAt || 0) };
        })
        // Held sessions stay on the board past the 24h window; archived ones leave it (see listArchived).
        .filter(s => (now - s.lastAt < DAY || s.active === 'hold') && s.active !== 'archive' && !s.app?.isArchived)
        .sort((a, b) => b.lastAt - a.lastAt);
    return seatAtDesks(candidates, MAX_DESKS).map(({ cli, state, app, lastAt }) => {
        const cwd = app?.cwd || state?.cwd || '';
        const transcript = state?.transcriptPath || (cwd ? transcriptPathFor(cwd, cli) : '');
        const lastText = transcript ? lastAssistantText(transcript) : '';
        const report = parseReport(lastText);
        const id = app?.sessionId || cli;
        // A summary describes the turn it was made for; once the session moves on it is stale.
        const s = summaries.read(id);
        const summary = s && s.at >= (state?.at || 0) ? s.text : null;
        const status = deriveStatus({ state, hasReport: !!report, decision: decisions[id] });
        const gi = gitInfo(cwd);
        const diffStat = ['review', 'question'].includes(status) ? statFor(id, state?.at, app) : null;
        return toSessionView({ cli, state, app, lastAt, cwd, transcript, lastText, report, id, summary, status, gi, diffStat, home: HOME });
    });
};
