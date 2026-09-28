// 오늘의 할 일 flows (design §6.3): list with derived status, create / update / soft delete, and start =
// open a new session whose first prompt line carries the todo's marker. Only what the user wrote is stored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TODO_FOLDERS_LIMIT } from '../config.mjs';
import * as todosStore from '../sources/todos.mjs';
import { loadAppSessions } from '../sources/app-sessions.mjs';
import { normalizeTodoPatch, toTodoView, visibleToday, isSameLocalDay } from '../domain/todo.mjs';
import { todoPrompt, newSessionLink } from '../domain/prompts.mjs';
import { openUrl } from '../platform/macos.mjs';
import { listSessions } from './list-sessions.mjs';
import { linkIndex } from './todo-links.mjs';

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
const folders = () =>
    [
        ...Map.groupBy(
            loadAppSessions()
                .map(a => ({ path: a.originCwd || a.cwd, lastAt: a.lastActivityAt || 0 }))
                .filter(f => f.path)
                .sort((a, b) => b.lastAt - a.lastAt),
            f => f.path,
        ).values(),
    ]
        .map(([newest]) => newest)
        .filter(f => isDir(f.path))
        .slice(0, TODO_FOLDERS_LIMIT)
        .map(f => ({ path: f.path, name: path.basename(f.path), lastAt: f.lastAt }));

export const listTodos = (now = Date.now()) => {
    const entries = Object.entries(todosStore.load());
    const index = links(now);
    return {
        todos: entries
            .filter(([, todo]) => !todo.deletedAt)
            .map(([id, todo]) => viewOf(id, todo, index, now))
            .filter(view => visibleToday(view, now))
            .sort((a, b) => a.createdAt - b.createdAt),
        // Deleted today = still offered for 되돌리기.
        deleted: entries.filter(([, todo]) => isSameLocalDay(todo.deletedAt, now)).map(([id, todo]) => ({ id, title: todo.title })),
        folders: folders(),
    };
};

export const createTodo = (raw, now = Date.now()) => {
    const result = normalizeTodoPatch(raw, { create: true });
    if (!result.ok) return { error: result.error };
    if (!isDir(result.patch.folder)) return { error: 'folder not found' };
    const id = newId(todosStore.load());
    const todo = { detail: '', ...result.patch, createdAt: now, source: 'manual', manual: null, deletedAt: null };
    todosStore.save(id, todo);
    return { todo: toTodoView({ id, todo, sessions: [], now }) };
};

// { done } records a manual check (it wins until something newer happens); { deleted: false } undoes a delete.
export const updateTodo = (id, raw, now = Date.now()) => {
    const current = find(todosStore.load(), id);
    if (!current) return { error: 'unknown todo' };
    const result = normalizeTodoPatch(raw);
    if (!result.ok) return { error: result.error };
    const { done, deleted, ...fields } = result.patch;
    if (fields.folder !== undefined && !isDir(fields.folder)) return { error: 'folder not found' };
    const todo = {
        ...current,
        ...fields,
        ...(done === undefined ? {} : { manual: { state: done ? 'done' : 'open', at: now } }),
        ...(deleted === false ? { deletedAt: null } : {}),
    };
    todosStore.save(id, todo);
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
