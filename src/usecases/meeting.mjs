// 회의실 flows (meeting-room design §2, §4, §5): find today's facilitator sessions by their #meeting- marker,
// keep the 오늘 일지 auto block fresh, open a facilitator session, copy its `### 칠판` list onto the 칠판
// (meeting-board-sync design §2.2), and close a meeting into the note.
import fs from 'node:fs';
import path from 'node:path';
import { OFFICE_DIR, GUIDE_FILE } from '../config.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import * as todosStore from '../sources/todos.mjs';
import * as notes from '../sources/daily-notes.mjs';
import { ensureGuide } from '../sources/office-guide.mjs';
import { firstPromptHead, lastAssistantText } from '../sources/transcripts.mjs';
import { columnOf } from '../domain/board.mjs';
import { ANIMALS, hash } from '../domain/session-view.mjs';
import { meetingIdIn, meetingId, meetingPrompt, facilitatorGuide, GUIDE_HEADER, boardItems, syncPlan } from '../domain/meeting.mjs';
import { visibleToday } from '../domain/todo.mjs';
import { autoSection, replaceAuto, meetingSection, appendSection, localDate, startOfYesterday, narrativeOf } from '../domain/daily-note.mjs';
import { newSessionLink } from '../domain/prompts.mjs';
import { openUrl } from '../platform/macos.mjs';
import { archive } from './decide.mjs';
import { collectCandidates, transcriptOf, listSessions } from './list-sessions.mjs';
import { listTodos, allViews, folders, createTodo, updateTodo, deleteTodo } from './todos.mjs';
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

// ── 칠판 sync (meeting-board-sync design §2.2-2.3): the server timer and 회의 끝 call it ──

// meetingId -> hash of the reply last handled: an unchanged reply is not planned again.
const handled = new Map();
// The last sync's result for the 회의실 status line (skipped items belong to that meeting only).
const lastSync = { meetingId: null, skipped: [], at: null };
const synced = (meetingId, counts = {}) => ({ meetingId, created: 0, updated: 0, removed: 0, skipped: [], ...counts });
// One applied write; an { error } result becomes a skipped item.
const outcome = (kind, todo, result) => ({ kind, title: todo.title, folder: todo.folder, result });

// The latest open facilitator's last `### 칠판` list -> create / update / soft delete. force = plan again even
// for a reply already handled (회의 끝). A reply without a list changes nothing, so it never clears the 칠판.
export const syncMeetingBoard = (now = Date.now(), { force = false } = {}) => {
    const [latest] = facilitators(now);
    if (!latest || latest.view.status === 'archived') return synced(null);
    const id = latest.meetingId;
    const message = latest.view.lastMessage || '';
    const seen = hash(message);
    if (!force && handled.get(id) === seen) return synced(id);
    const items = boardItems(message);
    if (!items.length) {
        handled.set(id, seen);
        return synced(id);
    }
    // Today's 칠판 (duplicates) plus this meeting's own, deleted ones too (a deleted one is not written again).
    const todos = allViews(now).filter(v => v.meeting?.id === id || (!v.deletedAt && visibleToday(v, now)));
    const plan = syncPlan({ meetingId: id, items, todos, folders: folders() });
    const byId = new Map(todos.map(t => [t.id, t]));
    const writes = [
        ...plan.create.map(c => outcome('created', c, createTodo({ title: c.title, folder: c.folder, detail: c.detail }, now, { source: 'scrum', meeting: { id, key: c.key } }))),
        ...plan.update.map(u => outcome('updated', byId.get(u.id), updateTodo(u.id, u.patch, now))),
        ...plan.remove.map(tid => outcome('removed', byId.get(tid), deleteTodo(tid, now))),
    ];
    const done = kind => writes.filter(w => w.kind === kind && !w.result.error).length;
    const skipped = [...plan.skipped, ...writes.filter(w => w.result.error).map(w => ({ title: w.title, folder: w.folder, reason: w.result.error }))];
    // Remembered only once written: a throw above retries on the next tick (the keys keep that idempotent).
    handled.set(id, seen);
    Object.assign(lastSync, { meetingId: id, skipped, at: now });
    return synced(id, { created: done('created'), updated: done('updated'), removed: done('removed'), skipped });
};

// 회의실 status line: live todos this meeting put on the 칠판, and what its last sync could not write.
const boardState = latest => {
    if (!latest) return { meetingId: null, count: 0, skipped: [] };
    const id = latest.meetingId;
    const count = Object.values(todosStore.load()).filter(t => !t.deletedAt && t.meeting?.id === id).length;
    return { meetingId: id, count, skipped: lastSync.meetingId === id ? lastSync.skipped : [] };
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
        board: boardState(latest),
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
    const sessions = recentWork(now).map(w => ({ ...w.view, folder: w.folder }));
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

// Copies the facilitator's last list onto the 칠판, archives it (if still open) and appends `## 회의 n`.
// Without a facilitator the 칠판 alone is recorded.
export const endMeeting = (now = Date.now()) => {
    syncMeetingBoard(now, { force: true });
    const date = localDate(now);
    const [latest] = facilitators(now);
    if (latest && latest.view.status !== 'archived') archive(latest.view);
    if (notes.read(date) === null) refreshNote(now);
    const n = latest?.n ?? 1;
    const section = meetingSection({ n, startedAt: latest?.startedAt || now, endedAt: now, todos: listTodos(now).todos, lastMessage: latest?.view.lastMessage });
    return { note: notes.write(date, appendSection(notes.read(date), section)), n };
};

// Called once at server start; a hand-edited guide of the same version is kept.
export const installGuide = () => ensureGuide(facilitatorGuide(), GUIDE_HEADER);
