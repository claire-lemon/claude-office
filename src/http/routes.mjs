// Route table 'METHOD /api/name' -> handler(req, res, id, url). Handlers only normalize input, call a
// usecase, and map to status codes -- same status codes and JSON bodies as before.
import { listSessions } from '../usecases/list-sessions.mjs';
import { getChanges } from '../usecases/get-changes.mjs';
import * as decide from '../usecases/decide.mjs';
import { startNextTask } from '../usecases/next-task.mjs';
import { summarize } from '../usecases/summarize.mjs';
import { moveSession } from '../usecases/move.mjs';
import { editSession } from '../usecases/edit-session.mjs';
import { listTodos, todoHistory, createTodo, updateTodo, deleteTodo, startTodo } from '../usecases/todos.mjs';
import { getMeeting, startMeeting, endMeeting } from '../usecases/meeting.mjs';
import { readJsonBody } from './body.mjs';

export const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const findSession = id => listSessions().find(s => s.id === id);

// A 2000-char Korean detail is ~6KB of JSON, over readJsonBody's 4KB default.
const TODO_BODY_LIMIT = 16 * 1024;
// Todo usecase errors that mean "no such thing"; every other one is a bad request.
const TODO_NOT_FOUND = new Set(['unknown todo', 'repo folder not found']);
const todoError = (res, error) => send(res, TODO_NOT_FOUND.has(error) ? 404 : 400, { error });
// POST /api/meeting/<action>: the id segment picks the action.
const MEETING_ACTIONS = { start: startMeeting, end: endMeeting };

export const routes = {
    'GET /api/sessions': (req, res) => send(res, 200, { now: Date.now(), sessions: listSessions() }),
    'GET /api/diff': (req, res, id) => {
        const s = findSession(id);
        return s ? send(res, 200, getChanges(s)) : send(res, 404, { error: 'unknown session' });
    },
    'POST /api/confirm': (req, res, id) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        return send(res, 200, { ok: true, ...decide.confirm(s) });
    },
    'POST /api/next': (req, res, id, url) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        const result = startNextTask(s, Number(url.searchParams.get('index') || 0));
        if (result.error) return send(res, 404, { error: result.error });
        return send(res, 200, { ok: true, opened: result.opened });
    },
    'POST /api/undo': (req, res, id) => {
        decide.undo(id);
        return send(res, 200, { ok: true });
    },
    'POST /api/hold': (req, res, id) => {
        if (!findSession(id)) return send(res, 404, { error: 'unknown session' });
        decide.hold(id);
        return send(res, 200, { ok: true });
    },
    'POST /api/archive': (req, res, id) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        decide.archive(s);
        return send(res, 200, { ok: true });
    },
    'GET /api/archived': (req, res) => send(res, 200, { archived: decide.listArchived() }),
    'POST /api/restore': (req, res, id) => {
        if (!decide.restore(id)) return send(res, 404, { error: 'not archived' });
        return send(res, 200, { ok: true });
    },
    'POST /api/open': (req, res, id) => {
        const s = findSession(id);
        if (!s?.link?.startsWith('claude://')) return send(res, 404, { error: 'no chat link' });
        decide.openChat(s);
        return send(res, 200, { ok: true });
    },
    'POST /api/summary': (req, res, id) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        summarize(s)
            .then(out => send(res, 200, { summary: out }))
            .catch(() => send(res, 502, { error: '요약 생성 실패' }));
    },
    // 결재함 drag: ?to=<column>. 409 carries the allowed moves so the board can resync.
    'POST /api/move': (req, res, id, url) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        const result = moveSession(s, url.searchParams.get('to'));
        if (result.error) return send(res, 409, { error: result.error, moves: s.moves });
        return send(res, 200, result);
    },
    'POST /api/edit': async (req, res, id) => {
        const body = await readJsonBody(req);
        if (!body.ok) return send(res, body.code, { error: body.error });
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        const result = editSession(s, body.value);
        if (result.error) return send(res, 400, { error: result.error });
        return send(res, 200, result);
    },
    'GET /api/todos': (req, res) => send(res, 200, listTodos()),
    // 보관함 "지난 할 일": todos the 칠판 no longer shows.
    'GET /api/todo-history': (req, res) => send(res, 200, todoHistory()),
    // One route key for both: no id = create (201), /api/todos/:id = update (done, deleted:false live here too).
    'POST /api/todos': async (req, res, id) => {
        const body = await readJsonBody(req, { limit: TODO_BODY_LIMIT });
        if (!body.ok) return send(res, body.code, { error: body.error });
        const result = id ? updateTodo(id, body.value) : createTodo(body.value);
        if (result.error) return todoError(res, result.error);
        return send(res, id ? 200 : 201, { ok: true, todo: result.todo });
    },
    'DELETE /api/todos': (req, res, id) => {
        const result = deleteTodo(id);
        if (result.error) return todoError(res, result.error);
        return send(res, 200, { ok: true });
    },
    'POST /api/start': (req, res, id) => {
        const result = startTodo(id);
        if (result.error) return todoError(res, result.error);
        return send(res, 200, { ok: true, opened: result.opened });
    },
    'GET /api/meeting': (req, res) => send(res, 200, getMeeting()),
    'POST /api/meeting': (req, res, id) =>
        Object.hasOwn(MEETING_ACTIONS, id) ? send(res, 200, { ok: true, ...MEETING_ACTIONS[id]() }) : send(res, 404, { error: 'unknown action' }),
};
