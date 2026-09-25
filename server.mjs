#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSessions, diffFor, readJson, writeJsonAtomic, lastAssistantText, CONFIRMED_FILE, SUMMARY_DIR } from './lib.mjs';

const PORT = Number(process.env.OFFICE_PORT || 7777);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, process.env.OFFICE_PUBLIC || 'public');
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const SUMMARY_PROMPT = `아래는 Claude Code 작업 세션의 마지막 대화와 변경 통계다. 팀 리드가 결재할 수 있게 정확히 이 포맷으로만 한국어로 답하라.
## 결재 보고
### 한 줄 요약
### 리뷰 필요
- \`파일:라인\` — 왜 봐야 하는지
### 리스크 / 배포 의존성
### 테스트 방법
1. ...
`;

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const findSession = id => buildSessions().find(s => s.id === id);

const routes = {
    'GET /api/sessions': (req, res) => send(res, 200, { now: Date.now(), sessions: buildSessions() }),
    'GET /api/diff': (req, res, id) => {
        const s = findSession(id);
        return s ? send(res, 200, diffFor(s)) : send(res, 404, { error: 'unknown session' });
    },
    'POST /api/confirm': (req, res, id) => {
        if (!findSession(id)) return send(res, 404, { error: 'unknown session' });
        writeJsonAtomic(CONFIRMED_FILE, { ...readJson(CONFIRMED_FILE, {}), [id]: Date.now() });
        return send(res, 200, { ok: true });
    },
    'POST /api/unconfirm': (req, res, id) => {
        const { [id]: _drop, ...rest } = readJson(CONFIRMED_FILE, {});
        writeJsonAtomic(CONFIRMED_FILE, rest);
        return send(res, 200, { ok: true });
    },
    'POST /api/open': (req, res, id) => {
        const s = findSession(id);
        if (!s?.link?.startsWith('claude://')) return send(res, 404, { error: 'no chat link' });
        execFile('open', [s.link], () => {});
        return send(res, 200, { ok: true });
    },
    'POST /api/summary': (req, res, id) => {
        const s = findSession(id);
        if (!s) return send(res, 404, { error: 'unknown session' });
        const d = diffFor(s);
        const input = `${SUMMARY_PROMPT}\n--- 마지막 응답 ---\n${lastAssistantText(s.transcript || '') || s.preview || ''}\n--- 변경 ---\n${d.stat || '없음'}\n${(d.files || []).map(f => f.path).join('\n')}`;
        const child = execFile('claude', ['-p', '--model', 'haiku'], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
            if (err) return send(res, 502, { error: '요약 생성 실패' });
            fs.mkdirSync(SUMMARY_DIR, { recursive: true });
            fs.writeFileSync(path.join(SUMMARY_DIR, `${id}.md`), out);
            return send(res, 200, { summary: out });
        });
        child.stdin.end(input);
    },
};

const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url, ORIGINS[0]);
        if (req.method === 'POST' && !ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'bad origin' });
        const [, , name, id = ''] = url.pathname.split('/');
        const route = url.pathname.startsWith('/api/') && routes[`${req.method} /api/${name}`];
        if (route) return route(req, res, decodeURIComponent(id));
        if (req.method !== 'GET') return send(res, 405, { error: 'method' });
        const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
        if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
        return send(res, 500, { error: String(e.message || e) });
    }
});

server.listen(PORT, '127.0.0.1', () => console.log(`office open: http://127.0.0.1:${PORT}`));
