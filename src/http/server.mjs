#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, PUBLIC_DIR, NARRATE_AUTO, NARRATE_EVERY, MEETING_SYNC_EVERY } from '../config.mjs';
import { routes, send } from './routes.mjs';
import { installGuide, syncMeetingBoard } from '../usecases/meeting.mjs';
import { narrateOnTimer } from '../usecases/narrate.mjs';

const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const fail = (res, e) => (res.headersSent ? res.destroy() : send(res, 500, { error: String(e.message || e) }));

const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url, ORIGINS[0]);
        // DNS rebinding: a hostile page can make the browser send any request here under its own hostname.
        // Only answer our own Host, for GETs too (they expose transcripts and diffs).
        if (!HOSTS.includes(req.headers.host)) return send(res, 403, { error: 'bad host' });
        // Anything that changes state (POST, DELETE, ...) must come from our own page.
        if (req.method !== 'GET' && !ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'bad origin' });
        const [, , name, id = ''] = url.pathname.split('/');
        const route = url.pathname.startsWith('/api/') && routes[`${req.method} /api/${name}`];
        // Handlers may be async; the catch below only sees sync throws.
        if (route) return Promise.resolve(route(req, res, decodeURIComponent(id), url)).catch(e => fail(res, e));
        if (req.method !== 'GET') return send(res, 405, { error: 'method' });
        const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
        if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
        return fail(res, e);
    }
});

// The facilitator session reads OFFICE_DIR/CLAUDE.md. A read-only home must not keep the office closed;
// stderr only (tests wait for the first stdout line).
try {
    installGuide();
} catch (e) {
    console.error(`facilitator guide not written: ${e.message}`);
}

// 오늘 일지 AI 서술: checked at start and every NARRATE_EVERY while the server runs; written once a day after
// NARRATE_HOUR (config NARRATE_AUTO says when the timer runs at all).
// ponytail: in-process timer, so no 서술 while the server is off; the CLI `narrate` covers cron/launchd if needed.
// Same lock as the 회의실 button: whichever comes second skips, and errors are logged there.
const narrate = () => narrateOnTimer();

// 회의실 → 칠판 (meeting-board-sync design §2.3): no open facilitator today (tests, a fresh office) = no-op, and
// an unchanged reply is skipped inside. One stderr line per failure; the next tick tries again.
const syncBoard = () => {
    try {
        syncMeetingBoard();
    } catch (e) {
        console.error(`meeting board sync failed: ${e.message}`);
    }
};

server.listen(PORT, '127.0.0.1', () => {
    console.log(`office open: http://127.0.0.1:${PORT}`);
    setInterval(syncBoard, MEETING_SYNC_EVERY);
    if (!NARRATE_AUTO) return;
    narrate();
    setInterval(narrate, NARRATE_EVERY);
});
