// Pure session-object assembly: no fs/child_process/Date.now/process.env. All IO results (gi, cwd
// existence, summary text, diffStat...) are gathered by the caller and passed in as plain data.
import path from 'node:path';
import { parseTasks } from './report.mjs';
import { columnOf, movesFor } from './board.mjs';

export const ANIMALS = ['cat', 'dog', 'rabbit', 'bear', 'penguin', 'fox', 'hamster', 'panda', 'duck', 'frog'];

export const hash = (s = '') => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// `home` is passed in (not read from config) so this module stays a pure function of its arguments.
export const tilde = (p, home) => (p && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);

// The app's own per-turn summary (local_*.json postTurnSummary: status_category/status_detail/needs_action).
// Internal app format: anything unexpected -> null.
export const toAppSummary = p =>
    p && typeof p.status_detail === 'string' && p.status_detail.trim()
        ? { category: String(p.status_category || ''), detail: p.status_detail, needsAction: String(p.needs_action || '') }
        : null;

// `override` = dashboard-only edits (title); `baseStatus` = status without the lead decision (for undo moves).
export const toSessionView = ({ cli, state, app, lastAt, cwd, transcript, lastText, report, id, summary, status, baseStatus, gi, diffStat, home, override }) => {
    const appTitle = app?.title || path.basename(cwd) || cli.slice(0, 8);
    return {
        id,
        cli,
        title: override?.title || appTitle,
        appTitle,
        animal: ANIMALS[hash(id) % ANIMALS.length],
        repo: gi.project || path.basename(app?.originCwd || cwd),
        repoHue: hash(app?.originCwd || cwd) % 360,
        status,
        column: columnOf(status),
        moves: movesFor({ status, baseStatus }),
        event: state?.event || null,
        eventAt: state?.at || null,
        message: state?.message || null,
        lastAt,
        branch: app?.branch || gi.branch,
        sourceBranch: app?.sourceBranch || null,
        originCwd: app?.originCwd || null,
        projectPath: tilde(app?.originCwd || cwd, home) || null,
        cwd: tilde(cwd, home) || null,
        nextTasks: parseTasks(report?.['다음 작업']),
        worktreePath: app?.worktreePath || null,
        prs: (app?.prs || []).map(p => ({ number: p.number, state: p.state, url: p.url })),
        turns: app?.completedTurns ?? null,
        link: app?.sessionId ? `claude://claude.ai/epitaxy/${app.sessionId}` : null,
        transcript,
        report,
        summary,
        appSummary: toAppSummary(app?.postTurnSummary),
        diffStat,
        preview: report ? null : lastText.slice(0, 300),
        lastMessage: lastText.slice(0, 20000),
    };
};
