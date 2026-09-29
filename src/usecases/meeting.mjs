// 회의실 flows (meeting-room design §2, §4, §5): find today's facilitator sessions by their #meeting- marker,
// keep the 오늘 일지 auto block fresh, open a facilitator session, and close a meeting into the note.
import fs from 'node:fs';
import path from 'node:path';
import { OFFICE_DIR, CLI_PATH, GUIDE_FILE } from '../config.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import * as todosStore from '../sources/todos.mjs';
import * as notes from '../sources/daily-notes.mjs';
import { ensureGuide } from '../sources/office-guide.mjs';
import { firstPromptHead, lastAssistantText } from '../sources/transcripts.mjs';
import { columnOf } from '../domain/board.mjs';
import { ANIMALS, hash } from '../domain/session-view.mjs';
import { meetingIdIn, meetingId, meetingPrompt, facilitatorGuide, GUIDE_HEADER } from '../domain/meeting.mjs';
import { autoSection, replaceAuto, meetingSection, appendSection, localDate, startOfYesterday, narrativeOf } from '../domain/daily-note.mjs';
import { newSessionLink } from '../domain/prompts.mjs';
import { openUrl } from '../platform/macos.mjs';
import { archive } from './decide.mjs';
import { collectCandidates, transcriptOf, listSessions } from './list-sessions.mjs';
import { listTodos } from './todos.mjs';
// Import cycle (narrate.mjs uses refreshNote/recentWork): fine, both sides read the other only inside functions.
import { narrationState } from './narrate.mjs';

// Off-board session view, same shape as todo-links' lean (it never reads the transcript tail or git).
// ponytail: copy of todo-links.mjs lean(); export it there if a third caller shows up.
const LEAN_STATUS = { archive: 'archived', confirm: 'done' };
const lean = ({ cli, state, app, id, active, lastAt }, decisions, overrides) => {
    const status = LEAN_STATUS[active] || 'stale';
    return {
        id,
        title: overrides[id]?.title || app?.title || path.basename(app?.cwd || state?.cwd || '') || cli.slice(0, 8),
        animal: ANIMALS[hash(id) % ANIMALS.length],
        status,
        column: columnOf(status),
        lastAt,
        decidedAt: active ? decisions[id].at : null,
    };
};

// Every session (on the board or not) with its transcript and the meeting marker in its first prompt.
const withMarkers = () => {
    const decisions = decisionsStore.load();
    const overrides = overridesStore.load();
    return collectCandidates({ decisions }).map(c => {
        const transcript = transcriptOf(c);
        return { c, transcript, meetingId: meetingIdIn(firstPromptHead(transcript)), lean: lean(c, decisions, overrides) };
    });
};

// Today's facilitators, highest meeting number first: { id, meetingId, n, startedAt, view }. view = the full
// SessionView when on the board, else the lean one plus the last reply (the 회의실 shows it either way).
export const facilitators = (now = Date.now()) => {
    const prefix = `${localDate(now)}-`;
    const board = new Map(listSessions(now).map(s => [s.id, s]));
    return withMarkers()
        .filter(m => m.meetingId?.startsWith(prefix))
        .map(({ c, transcript, meetingId: mid, lean: leanView }) => ({
            id: c.id,
            meetingId: mid,
            n: Number(mid.slice(prefix.length)),
            startedAt: c.app?.createdAt || null,
            view: board.get(c.id) ?? { ...leanView, lastMessage: lastAssistantText(transcript).slice(0, 20000) },
        }))
        .sort((a, b) => b.n - a.n);
};

export const getMeeting = (now = Date.now()) => {
    const date = localDate(now);
    const [latest] = facilitators(now);
    const file = notes.pathFor(date);
    return {
        date,
        note: { path: file, exists: fs.existsSync(file) },
        session: latest?.view ?? null,
        // Archived = the lean status; an archived session is never on the board.
        ended: latest?.view.status === 'archived',
        count: latest?.n ?? 0,
        // 업무일지 card (finishing design §2.1): today's AI 서술 and the in-server run, if any.
        narrative: { ...narrativeOf(notes.read(date), date), running: narrationState.running, startedAt: narrationState.startedAt, error: narrationState.error },
    };
};

// Work sessions active since yesterday 00:00, newest first: { view (board view, else lean, + todoTitle),
// transcript, folder }. Facilitator sessions are left out: they are meetings, not work.
export const recentWork = (now = Date.now()) => {
    const since = startOfYesterday(now);
    const board = new Map(listSessions(now).map(s => [s.id, s]));
    const stored = todosStore.load();
    const todoTitle = id => (id && Object.hasOwn(stored, id) ? stored[id].title : null);
    return withMarkers()
        .filter(m => !m.meetingId && m.c.lastAt >= since)
        .sort((a, b) => b.c.lastAt - a.c.lastAt)
        .map(({ c, transcript, lean: leanView }) => {
            const view = board.get(c.id) ?? leanView;
            return { view: { ...view, todoTitle: todoTitle(view.todoId) }, transcript, folder: c.app?.originCwd || c.app?.cwd || c.state?.cwd || '' };
        });
};

// Rebuilds the note's auto block (yesterday 00:00 onward + the 칠판 + 할 일 기록 + folders) and keeps the rest.
export const refreshNote = (now = Date.now()) => {
    const date = localDate(now);
    const since = startOfYesterday(now);
    const sessions = recentWork(now).map(w => w.view);
    const { todos, folders, history } = listTodos(now, { since });
    return notes.write(date, replaceAuto(notes.read(date), autoSection({ date, since, sessions, todos, folders, history }), date));
};

export const startMeeting = (now = Date.now()) => {
    fs.mkdirSync(OFFICE_DIR, { recursive: true });
    const note = refreshNote(now);
    const id = meetingId(localDate(now), (facilitators(now)[0]?.n ?? 0) + 1);
    const opened = newSessionLink(OFFICE_DIR, meetingPrompt(id, note, GUIDE_FILE));
    openUrl(opened);
    return { opened, note, id };
};

// Archives the latest facilitator (if still open) and appends `## 회의 n`. Without a facilitator the 칠판
// alone is recorded.
export const endMeeting = (now = Date.now()) => {
    const date = localDate(now);
    const [latest] = facilitators(now);
    if (latest && latest.view.status !== 'archived') archive(latest.view);
    if (notes.read(date) === null) refreshNote(now);
    const n = latest?.n ?? 1;
    const section = meetingSection({ n, startedAt: latest?.startedAt || now, endedAt: now, todos: listTodos(now).todos, lastMessage: latest?.view.lastMessage });
    return { note: notes.write(date, appendSection(notes.read(date), section)), n };
};

// Called once at server start; a hand-edited guide of the same version is kept.
export const installGuide = () => ensureGuide(facilitatorGuide({ cliPath: CLI_PATH }), GUIDE_HEADER);
