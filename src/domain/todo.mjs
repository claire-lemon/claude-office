// Pure 오늘의 할 일 rules: the #todo- marker, editable fields, derived status, the API view, link snapshots.
// No fs/child_process/Date.now/process.env; `now` comes in as an argument.
import path from 'node:path';
import { columnOf } from './board.mjs';

// A new session's first prompt line carries the marker; the server finds it in the transcript head.
export const TODO_MARK = /#todo-([a-z0-9]{6})\b/;
export const markerLine = (id, title) => `📋 오늘의 할 일 #todo-${id} · ${title}`;
export const todoIdIn = text => (typeof text === 'string' && text.match(TODO_MARK)?.[1]) || null;

// Editable fields, one row each (same idea as EDITABLE_FIELDS for session titles). Folder existence is
// checked by the usecase (fs), not here.
export const TODO_FIELDS = {
    title: { maxLength: 120, required: true },
    detail: { maxLength: 2000, multiline: true },
    folder: { path: true, required: true },
};

// Update-only switches: the checkbox (manual done/open) and 되돌리기 (undo a soft delete).
const SWITCHES = {
    done: v => typeof v === 'boolean' || 'done must be a boolean',
    deleted: v => v === false || 'deleted must be false',
};

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Control chars become spaces (detail keeps its newlines); the cut counts code points so Korean/emoji aren't split.
const cleanField = (value, rule) => {
    if (rule.path) return value.trim().replace(/(.)\/+$/, '$1');
    const flat = rule.multiline
        ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
        : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ');
    return [...flat.trim()].slice(0, rule.maxLength).join('').trim();
};

// -> { ok: true, patch } | { ok: false, error }. create: title + folder required, switches not accepted.
export const normalizeTodoPatch = (raw, { create = false } = {}) => {
    if (!isPlainObject(raw)) return { ok: false, error: 'body must be an object' };
    const keys = Object.keys(raw);
    if (!create && !keys.length) return { ok: false, error: 'empty patch' };
    const allowed = create ? TODO_FIELDS : { ...TODO_FIELDS, ...SWITCHES };
    const unknown = keys.find(k => !Object.hasOwn(allowed, k));
    if (unknown) return { ok: false, error: `unknown field: ${unknown}` };
    const notString = keys.find(k => Object.hasOwn(TODO_FIELDS, k) && typeof raw[k] !== 'string');
    if (notString) return { ok: false, error: `${notString} must be a string` };
    const badSwitch = keys.filter(k => Object.hasOwn(SWITCHES, k)).map(k => SWITCHES[k](raw[k])).find(r => r !== true);
    if (badSwitch) return { ok: false, error: badSwitch };
    const patch = Object.fromEntries(keys.map(k => [k, Object.hasOwn(TODO_FIELDS, k) ? cleanField(raw[k], TODO_FIELDS[k]) : raw[k]]));
    const missing = Object.keys(TODO_FIELDS).find(k => TODO_FIELDS[k].required && (create || k in patch) && !patch[k]);
    if (missing) return { ok: false, error: `${missing} required` };
    if (patch.folder !== undefined && !patch.folder.startsWith('/')) return { ok: false, error: 'folder must be an absolute path' };
    return { ok: true, patch };
};

// Latest linked session's status -> todo status. One row per rule.
export const STATUS_OF_SESSION = {
    working: 'started', review: 'started', question: 'started', blocked: 'started',
    hold: 'started', unknown: 'started', stale: 'started',
    done: 'done', archived: 'done',
};

export const byRecent = (a, b) => b.lastAt - a.lastAt;

// -> { status: open|started|done, doneAt, by: manual|session|null }. The newer of the manual check and the
// latest session's own moment wins. A manual "open" on a todo that still has sessions reads as started.
export const todoStatus = ({ todo, sessions }) => {
    const manual = todo.manual || null;
    const [latest] = [...sessions].sort(byRecent);
    if (!latest) {
        return manual?.state === 'done' ? { status: 'done', doneAt: manual.at, by: 'manual' } : { status: 'open', doneAt: null, by: manual ? 'manual' : null };
    }
    const fromSession = STATUS_OF_SESSION[latest.status] ?? 'started';
    const sessionAt = (fromSession === 'done' ? latest.decidedAt : latest.lastAt) || 0;
    if (manual && manual.at > sessionAt) {
        return manual.state === 'done' ? { status: 'done', doneAt: manual.at, by: 'manual' } : { status: 'started', doneAt: null, by: 'manual' };
    }
    return { status: fromSession, doneAt: fromSession === 'done' ? latest.decidedAt : null, by: 'session' };
};

// Local (server timezone) calendar day.
export const isSameLocalDay = (a, b) => a != null && b != null && new Date(a).toDateString() === new Date(b).toDateString();

// The 칠판 shows open/started always; done only on the day it was done (hidden after midnight).
export const visibleToday = (view, now) => view.status !== 'done' || isSameLocalDay(view.doneAt, now);

export const toTodoView = ({ id, todo, sessions, now }) => {
    const sorted = [...sessions].sort(byRecent);
    return {
        ...todo,
        id,
        project: path.basename(todo.folder || ''),
        ...todoStatus({ todo, sessions: sorted, now }),
        sessions: sorted,
        latest: sorted[0] ?? null,
    };
};

// ── 연결 기록 (todo-history design §3.1): links.json keeps every link seen, so it outlives its transcript ──

// Fields whose change is worth a write. lastAt alone is not: it moves every turn and the 칠판 polls every 2s.
const SNAPSHOT_KEYS = ['todoId', 'title', 'status', 'decidedAt'];
const toRecord = (todoId, view, seenAt) => ({
    todoId, title: view.title, animal: view.animal, status: view.status, decidedAt: view.decidedAt ?? null, lastAt: view.lastAt, seenAt,
});

// stored = links.json, live = [{ todoId, view }] found by marker now. -> { [sessionId]: LinkRecord } to upsert:
// new links and ones whose todo / title / status / decision moved. seenAt = when the link was first seen.
export const linkChanges = (stored, live, now) =>
    Object.fromEntries(
        live
            .map(({ todoId, view }) => {
                const prev = Object.hasOwn(stored, view.id) ? stored[view.id] : null;
                return { id: view.id, prev, record: toRecord(todoId, view, prev?.seenAt ?? now) };
            })
            .filter(({ prev, record }) => !prev || SNAPSHOT_KEYS.some(k => prev[k] !== record[k]))
            .map(({ id, record }) => [id, record]),
    );

// A stored link whose marker is gone (transcript deleted): done/archived stay, anything else was cut off
// mid-way, so it reads stale.
const KEEPS_STATUS = new Set(['done', 'archived']);
const vanished = (id, r) => {
    const status = KEEPS_STATUS.has(r.status) ? r.status : 'stale';
    return { id, title: r.title, animal: r.animal, status, column: columnOf(status), lastAt: r.lastAt, decidedAt: r.decidedAt ?? null };
};

// -> Map<todoId, LinkedSession[]> recent first. A live view always wins over its snapshot (all its fields kept).
export const mergeLinks = (stored, live) => {
    const liveIds = new Set(live.map(l => l.view.id));
    const gone = Object.entries(stored)
        .filter(([id]) => !liveIds.has(id))
        .map(([id, r]) => ({ todoId: r.todoId, view: vanished(id, r) }));
    return new Map([...Map.groupBy([...live, ...gone], l => l.todoId)].map(([todoId, ls]) => [todoId, ls.map(l => l.view).sort(byRecent)]));
};

// Anything happened to the todo at or after `since`: written, done, deleted, checked, or a session moved.
export const touchedSince = (view, since) =>
    [view.createdAt, view.doneAt, view.deletedAt, view.manual?.at, ...(view.sessions || []).map(s => s.lastAt)].some(t => t != null && t >= since);
