import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 📓 업무일지: GET /api/journal, POST /api/narrate and the in-process lock. Own fixture home and port 7793
// (office 7794-7798, metrics 7799), a fake `claude` on PATH. config.mjs reads env at import time, so this is
// set before the dynamic imports below.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-journal-'));
process.env.OFFICE_HOME = HOME;
const { OFFICE_DIR } = await import('../../src/config.mjs');
const { NARRATIVE_SYSTEM } = await import('../../src/domain/prompts.mjs');
const { NARRATIVE_START, localDate } = await import('../../src/domain/daily-note.mjs');

const NOW = Date.now();
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const BIN = path.join(HOME, 'bin');
const CALLS = path.join(HOME, 'calls.jsonl');
const GATE = path.join(HOME, 'gate');
const repo = path.join(HOME, 'repos', 'api');
[APP, STATE, repo, BIN, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const userLine = content => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
const assistantLine = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const REPORT = '## 결재 보고\n### 한 줄 요약\n1. 업무일지 확인 완료\n### 다음 작업\n1. 후속 작업\n   1. 이어서 필요';
// A session on the board: app file + hook state + transcript (first prompt, then a report).
const session = (id, cli, firstPrompt, at) => {
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, userLine(firstPrompt) + assistantLine(REPORT));
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: cli, title: `${id} 세션`, cwd: repo, originCwd: repo, lastActivityAt: at, isArchived: false, prs: [] }));
    fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event: 'Stop', at, cwd: repo, transcriptPath: file }));
};

session('local_a', 'cli-a', '앱에서 바로 시작한 작업', NOW - 60_000);
session('local_b', 'cli-b', '또 다른 작업', NOW - 50_000);
// Before yesterday 00:00: never in the note.
fs.writeFileSync(path.join(APP, 'local_old.json'), JSON.stringify({ sessionId: 'local_old', cliSessionId: 'cli-old', title: '옛 세션', cwd: repo, lastActivityAt: NOW - 3 * 24 * 3600_000, isArchived: false, prs: [] }));

// Fake `claude`: logs each call (system prompt + input), then runs `body`.
const fakeClaude = body =>
    fs.writeFileSync(
        path.join(BIN, 'claude'),
        `#!/usr/bin/env node
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ system: args[args.indexOf('--system-prompt') + 1], input }) + '\\n');
${body}
`,
        { mode: 0o755 },
    );
const calls = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);

const PORT = '7793';
const origin = `http://127.0.0.1:${PORT}`;
const server = { proc: null };
before(async () => {
    server.proc = spawn('node', [path.join(ROOT, 'server.mjs')], {
        env: { ...process.env, OFFICE_HOME: HOME, OFFICE_DRY: '1', OFFICE_PORT: PORT, PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
    });
    await once(server.proc.stdout, 'data');
});
after(() => server.proc?.kill());

const req = async (method, p, body, headers = {}) => {
    const res = await fetch(`${origin}${p}`, {
        method,
        headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
};
const get = p => fetch(`${origin}${p}`).then(r => r.json());
const poll = async (until, tries = 100) => {
    const journal = await get('/api/journal');
    if (until(journal) || tries <= 0) return journal;
    await new Promise(r => setTimeout(r, 100));
    return poll(until, tries - 1);
};

test('narrate: 202 at once, running while the model works, a second press is `already`, then the note has it', async () => {
    // The fake model waits for the gate file, so the run is observably in progress.
    fakeClaude(`const out = () => process.stdout.write('1. **api**: 업무일지를 붙였다.\\n2. **남은 것**\\n   1. 없음');
const wait = () => (fs.existsSync(${JSON.stringify(GATE)}) ? out() : setTimeout(wait, 50));
wait();`);
    const date = localDate(Date.now());
    const empty = await get('/api/journal');
    assert.deepEqual(empty, {
        date,
        note: { path: path.join(OFFICE_DIR, 'daily', `${date}.md`), display: `~/.claude/office/daily/${date}.md`, exists: false },
        narrative: { exists: false, text: '', writtenAt: null, running: false, startedAt: null, error: null },
    });

    const first = await req('POST', '/api/narrate');
    assert.deepEqual(first, { status: 202, body: { ok: true, running: true, already: false } });
    const running = await get('/api/journal');
    assert.deepEqual([running.narrative.running, running.narrative.exists, typeof running.narrative.startedAt], [true, false, 'number']);
    assert.deepEqual(await req('POST', '/api/narrate'), { status: 202, body: { ok: true, running: true, already: true } });

    fs.writeFileSync(GATE, '');
    const { narrative } = await poll(m => !m.narrative.running);
    assert.equal(narrative.running, false);
    assert.equal(narrative.error, null);
    assert.equal(narrative.exists, true);
    assert.match(narrative.text, /^## 어제 이야기 \(AI 서술 · .* · \d{2}:\d{2} 작성\)\n1\. \*\*api\*\*: 업무일지를 붙였다\./);
    assert.equal(narrative.writtenAt, new Date(narrative.startedAt).setSeconds(0, 0));
    assert.equal(narrative.startedAt, running.narrative.startedAt);
    const narrations = calls().filter(c => c.system === NARRATIVE_SYSTEM);
    assert.equal(narrations.length, 1, 'the second press did not start another run');
    assert.match(narrations[0].input, /<session n="\d+">\n제목: local_a 세션\n/);
    assert.ok(!narrations[0].input.includes('옛 세션'), 'only sessions since yesterday 00:00');
    // the note: auto block of yesterday's sessions, then the narrative
    const note = fs.readFileSync(path.join(OFFICE_DIR, 'daily', `${date}.md`), 'utf8');
    assert.match(note, /## 어제 세션 \([^)]*\)\n1\. local_b 세션 — 결재 대기[^\n]*\n[\s\S]*2\. local_a 세션 — 결재 대기/);
    assert.ok(note.indexOf('## 어제 세션') < note.indexOf(NARRATIVE_START));
    assert.equal((await get('/api/journal')).note.exists, true);
});

test('narrate: a failed model call ends the run with an error and keeps the old narrative', async () => {
    fakeClaude("process.stderr.write('not logged in'); process.exit(1);");
    const prev = (await get('/api/journal')).narrative;
    assert.equal((await req('POST', '/api/narrate')).status, 202);
    const { narrative } = await poll(m => !m.narrative.running);
    assert.equal(narrative.running, false);
    assert.match(narrative.error, /not logged in|Command failed/);
    assert.deepEqual([narrative.exists, narrative.text, narrative.writtenAt], [true, prev.text, prev.writtenAt]);
    // the server is still up
    assert.equal((await get('/api/journal')).narrative.running, false);
});

test('narrate needs our Origin; the removed todo / meeting routes are gone', async () => {
    const before = calls().length;
    assert.equal((await fetch(`${origin}/api/narrate`, { method: 'POST', headers: { origin: 'http://evil.test' } })).status, 403);
    assert.equal(calls().length, before, 'no model call');
    assert.equal((await fetch(`${origin}/api/todos`)).status, 404);
    assert.equal((await fetch(`${origin}/api/meeting`)).status, 404);
    assert.equal((await req('POST', '/api/meeting/narrate')).status, 405);
});

// The server timer only runs for the real office (NARRATE_AUTO), so its lock is checked in this process.
test('in-process lock: the timer skips while a button run is going, runs under the same lock, a failure never rejects', async () => {
    const { narrationState, narrateInBackground, narrateOnTimer, waitNarration } = await import('../../src/usecases/narrate.mjs');
    const noon = new Date().setHours(12, 0, 0, 0);
    const note = path.join(OFFICE_DIR, 'daily', `${localDate(noon)}.md`);
    const dropNarrative = () => fs.writeFileSync(note, fs.readFileSync(note, 'utf8').split(NARRATIVE_START)[0]);
    const gate = {};
    const slow = () => new Promise(resolve => (gate.open = resolve));
    const timer = [];
    const timerRun = async () => (timer.push(1), '1. 타이머');

    dropNarrative();
    assert.deepEqual(narrateInBackground(noon, slow), { running: true, already: false });
    assert.deepEqual([narrationState.running, narrationState.startedAt], [true, noon]);
    assert.equal(narrateOnTimer(noon, timerRun), null, 'due, but a run is going');
    assert.deepEqual(narrateInBackground(noon, slow), { running: true, already: true });
    gate.open('1. 버튼');
    await waitNarration();
    assert.deepEqual([narrationState.running, narrationState.error, timer.length], [false, null, 0]);
    assert.equal(narrateOnTimer(noon, timerRun), null, 'written for today');

    dropNarrative();
    const run = narrateOnTimer(noon, timerRun);
    assert.equal(narrationState.running, true);
    await run;
    assert.deepEqual([narrationState.running, timer.length], [false, 1]);

    narrateInBackground(noon, async () => {
        throw new Error('boom');
    });
    await waitNarration();
    assert.deepEqual([narrationState.running, narrationState.error], [false, 'boom']);
});
