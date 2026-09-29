// 오늘의 할 일 flows (design §6.3): list with derived status, create / update / soft delete, and start =
// open a new session whose first prompt line carries the todo's marker. Only what the user wrote is stored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TODO_FOLDERS_LIMIT, OFFICE_DIR } from '../config.mjs';
import * as todosStore from '../sources/todos.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import { loadAppSessions } from '../sources/app-sessions.mjs';
import { firstPromptHead } from '../sources/transcripts.mjs';
import { normalizeTodoPatch, toTodoView, visibleToday, isSameLocalDay, touchedSince, todoIdIn, assignedTo } from '../domain/todo.mjs';
import { todoPrompt, newSessionLink } from '../domain/prompts.mjs';
import { openUrl } from '../platform/macos.mjs';
import { listSessions, collectCandidates, transcriptOf } from './list-sessions.mjs';
import { linkIndex, forgetLinks } from './todo-links.mjs';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newId = taken => {
    const id = Array.from(crypto.randomBytes(6), b => ID_CHARS[b % ID_CHARS.length]).join('');
    return Object.hasOwn(taken, id) ? newId(taken) : id;
};

const isDir = p => !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
const find = (file, id) => (Object.hasOwn(file, id) ? file[id] : null);
const links = now => linkIndex(listSessions(now), now);
const viewOf = (id, todo, index, now) => toTodoView({ id, todo, sessions: index.get(id) ?? [], now });

// Recent project folders for the add form: each app session's repo folder once, newest activity first.
// OFFICE_DIR is the 회의실 facilitator's folder, not a project.
export const folders = () =>
    [
        ...Map.groupBy(
            loadAppSessions()
                .map(a => ({ path: a.originCwd || a.cwd, lastAt: a.lastActivityAt || 0 }))
                .filter(f => f.path && f.path !== OFFICE_DIR)
                .sort((a, b) => b.lastAt - a.lastAt),
            f => f.path,
        ).values(),
    ]
        .map(([newest]) => newest)
        .filter(f => isDir(f.path))
        .slice(0, TODO_FOLDERS_LIMIT)
        .map(f => ({ path: f.path, name: path.basename(f.path), lastAt: f.lastAt }));

// Every todo as a view, deleted ones included (one linkIndex per call).
export const allViews = now => {
    const index = links(now);
    return Object.entries(todosStore.load()).map(([id, todo]) => viewOf(id, todo, index, now));
};
const byCreated = (a, b) => a.createdAt - b.createdAt;

// { since } adds `history`: every todo touched from then on, deleted ones too (the note's 할 일 기록).
export const listTodos = (now = Date.now(), { since } = {}) => {
    const views = allViews(now);
    return {
        todos: views.filter(view => !view.deletedAt && visibleToday(view, now)).sort(byCreated),
        // Deleted today = still offered for 되돌리기.
        deleted: views.filter(view => isSameLocalDay(view.deletedAt, now)).map(({ id, title }) => ({ id, title })),
        folders: folders(),
        ...(since == null ? {} : { history: views.filter(view => touchedSince(view, since)).sort(byCreated) }),
    };
};

// 보관함 "지난 할 일": what the 칠판 no longer shows (deleted, or done before today), latest ending first.
export const todoHistory = (now = Date.now()) => ({
    todos: allViews(now)
        .filter(view => view.deletedAt || !visibleToday(view, now))
        .sort((a, b) => (b.doneAt || b.deletedAt) - (a.doneAt || a.deletedAt)),
});

// Who wrote the todo: the 칠판 form (HTTP), the 회의실 sync or the CLI (--source scrum).
const SOURCES = ['manual', 'scrum'];
// meeting = { id, key }: the 회의실 sync's own (meeting-board-sync design §2.2), found again by key.
const isMeetingRef = m => typeof m?.id === 'string' && typeof m?.key === 'string';

export const createTodo = (raw, now = Date.now(), { source = 'manual', meeting } = {}) => {
    const result = normalizeTodoPatch(raw, { create: true });
    if (!result.ok) return { error: result.error };
    if (!isDir(result.patch.folder)) return { error: 'folder not found' };
    const id = newId(todosStore.load());
    const todo = {
        detail: '', ...result.patch, createdAt: now, source: SOURCES.includes(source) ? source : 'manual', manual: null, deletedAt: null,
        ...(isMeetingRef(meeting) ? { meeting: { id: meeting.id, key: meeting.key } } : {}),
    };
    todosStore.save(id, todo);
    return { todo: toTodoView({ id, todo, sessions: [], now }) };
};

// One todo as a view, off the 칠판 or deleted too (✨ 다듬기); null when there is no such todo.
export const todoView = (id, now = Date.now()) => {
    const todo = find(todosStore.load(), id);
    return todo ? viewOf(id, todo, links(now), now) : null;
};

// 세션 배정 (finishing design §4.1) -> { error } | { marker } (true = this todo's by marker already: nothing to
// store). Any session the office knows can be assigned, archived ones too; a marker link is never moved.
const checkAssign = (id, sessionId) => {
    const c = collectCandidates({ decisions: decisionsStore.load() }).find(x => x.id === sessionId);
    if (!c) return { error: 'unknown session' };
    const marker = todoIdIn(firstPromptHead(transcriptOf(c)));
    if (marker && marker !== id) return { error: 'already linked' };
    return { marker: marker === id };
};

// { done } records a manual check (it wins until something newer happens); { deleted: false } undoes a delete;
// { assign } / { unassign } add / drop a session by hand (one session, one todo: assigning moves it).
export const updateTodo = (id, raw, now = Date.now()) => {
    const stored = todosStore.load();
    const current = find(stored, id);
    if (!current) return { error: 'unknown todo' };
    const result = normalizeTodoPatch(raw);
    if (!result.ok) return { error: result.error };
    const { done, deleted, assign, unassign, ...fields } = result.patch;
    if (fields.folder !== undefined && !isDir(fields.folder)) return { error: 'folder not found' };
    const check = assign === undefined ? {} : checkAssign(id, assign);
    if (check.error) return { error: check.error };
    const adding = assign !== undefined && !check.marker ? assign : null;
    // Moving: the other todo lets go first, so a crash between the two writes never leaves it in both lists.
    // ponytail: two writes (sources/todos.mjs saves one record); add a saveMany there if this needs to be atomic.
    const owner = adding && assignedTo(stored, adding);
    if (owner && owner !== id) todosStore.save(owner, { ...stored[owner], assigned: stored[owner].assigned.filter(s => s !== adding) });
    const before = current.assigned ?? [];
    const kept = before.filter(s => s !== unassign);
    const assigned = adding && !kept.includes(adding) ? [...kept, adding] : kept;
    const todo = {
        ...current,
        ...fields,
        ...(done === undefined ? {} : { manual: { state: done ? 'done' : 'open', at: now } }),
        ...(deleted === false ? { deletedAt: null } : {}),
        ...(assign === undefined && unassign === undefined ? {} : { assigned }),
    };
    todosStore.save(id, todo);
    // Only what this todo really let go: a no-op unassign must not drop another link's snapshot.
    const dropped = before.filter(s => !assigned.includes(s));
    if (dropped.length) forgetLinks(dropped);
    return { todo: viewOf(id, todo, links(now), now) };
};

// Soft delete: the id survives so 되돌리기 keeps every marker link intact.
export const deleteTodo = (id, now = Date.now()) => {
    const current = find(todosStore.load(), id);
    if (!current) return { error: 'unknown todo' };
    todosStore.save(id, { ...current, deletedAt: now });
    return { ok: true };
};

// Opens the prefilled new-session input only; nothing is marked until the session itself shows up.
export const startTodo = (id, now = Date.now()) => {
    const todo = find(todosStore.load(), id);
    if (!todo || todo.deletedAt) return { error: 'unknown todo' };
    if (!isDir(todo.folder)) return { error: 'repo folder not found' };
    const view = viewOf(id, todo, links(now), now);
    const link = newSessionLink(todo.folder, todoPrompt(view, view.latest));
    openUrl(link);
    return { opened: link };
};
