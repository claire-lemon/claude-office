// Route table 'METHOD /api/name' -> handler(req, res, id, url). Handlers only normalize input, call a
// usecase, and map to status codes -- same status codes and JSON bodies as before.
import { listSessions } from '../usecases/list-sessions.mjs';
import { getChanges } from '../usecases/get-changes.mjs';
import * as decide from '../usecases/decide.mjs';
import { startNextTask } from '../usecases/next-task.mjs';
import { summarize } from '../usecases/summarize.mjs';

export const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const findSession = id => listSessions().find(s => s.id === id);

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
};
