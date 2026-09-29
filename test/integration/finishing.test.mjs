import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Finishing touches (finishing design §6): 세션 배정, ✨ 다듬기, 회의실 업무일지 button. Own fixture home and
// port (meeting 7791, todos 7792, office 7794-7798, metrics 7799), a fake `claude` on PATH. config.mjs reads
// env at import time, so this is set before the dynamic imports below.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-finishing-'));
process.env.OFFICE_HOME = HOME;
const { OFFICE_DIR } = await import('../../src/config.mjs');
const { markerLine } = await import('../../src/domain/todo.mjs');
const { REFINE_SYSTEM, NARRATIVE_SYSTEM } = await import('../../src/domain/prompts.mjs');
const { NARRATIVE_START, localDate } = await import('../../src/domain/daily-note.mjs');

const NOW = Date.now();
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const TODOS = path.join(OFFICE_DIR, 'todos.json');
const LINKS = path.join(OFFICE_DIR, 'links.json');
const BIN = path.join(HOME, 'bin');
const CALLS = path.join(HOME, 'calls.jsonl');
const GATE = path.join(HOME, 'gate');
const repo = path.join(HOME, 'repos', 'api');
[APP, STATE, repo, BIN, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const userLine = content => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
const assistantLine = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const REPORT = '## 결재 보고\n### 한 줄 요약\n1. 배정 확인 완료\n### 다음 작업\n1. 후속 작업\n   1. 이어서 필요';
// A session on the board: app file + hook state + transcript (first prompt, then a report).
const session = (id, cli, firstPrompt, at) => {
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, userLine(firstPrompt) + assistantLine(REPORT));
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: cli, title: `${id} 세션`, cwd: repo, originCwd: repo, lastActivityAt: at, isArchived: false, prs: [] }));
    fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event: 'Stop', at, cwd: repo, transcriptPath: file }));
};

// Two todos written before 세션 배정 existed (no `assigned`); local_m was started from fin001's [시작].
const record = title => ({ title, detail: '원래 메모', folder: repo, createdAt: NOW - 3600_000, source: 'manual', manual: null, deletedAt: null });
fs.writeFileSync(TODOS, JSON.stringify({ fin001: record('배정 1'), fin002: record('배정 2') }));
session('local_a', 'cli-a', '앱에서 바로 시작한 작업', NOW - 60_000);
session('local_b', 'cli-b', '또 다른 작업', NOW - 50_000);
session('local_m', 'cli-m', markerLine('fin001', '배정 1'), NOW - 40_000);
// Off the board: 3 days old, no hook state.
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
const todo = async id => (await get('/api/todos')).todos.find(t => t.id === id);
const board = async id => (await get('/api/sessions')).sessions.find(s => s.id === id);
const stored = () => JSON.parse(fs.readFileSync(TODOS, 'utf8'));
const links = () => (fs.existsSync(LINKS) ? JSON.parse(fs.readFileSync(LINKS, 'utf8')) : {});
const via = t => t.sessions.map(s => [s.id, s.via]);
const assign = (id, sessionId) => req('POST', `/api/todos/${id}`, { assign: sessionId });
const unassign = (id, sessionId) => req('POST', `/api/todos/${id}`, { unassign: sessionId });

test('assign: an app-started session joins the todo (via assigned), /api/sessions shows todoId + todoVia', async () => {
    const first = await todo('fin001');
    assert.deepEqual([first.assigned, via(first)], [[], [['local_m', 'marker']]]);

    const res = await assign('fin001', 'local_a');
    assert.equal(res.status, 200);
    assert.deepEqual(via(res.body.todo), [['local_m', 'marker'], ['local_a', 'assigned']]);
    assert.deepEqual(res.body.todo.assigned, ['local_a']);
    const listed = await todo('fin001');
    assert.deepEqual(via(listed), [['local_m', 'marker'], ['local_a', 'assigned']]);
    assert.deepEqual([listed.status, listed.by], ['started', 'session']);
    assert.deepEqual(stored().fin001.assigned, ['local_a']);
    assert.deepEqual([links().local_a.todoId, links().local_a.via, links().local_m.via], ['fin001', 'assigned', 'marker']);

    const s = await get('/api/sessions');
    assert.ok(s.sessions.every(x => Object.hasOwn(x, 'todoVia')));
    const pick = id => s.sessions.find(x => x.id === id);
    assert.deepEqual(['local_a', 'local_m', 'local_b'].map(id => [pick(id).todoId, pick(id).todoVia]), [['fin001', 'assigned'], ['fin001', 'marker'], [null, null]]);

    // again: still once
    assert.equal((await assign('fin001', 'local_a')).status, 200);
    assert.deepEqual(stored().fin001.assigned, ['local_a']);
});

test('assign moves a session from another todo; a no-op unassign keeps its link', async () => {
    const res = await assign('fin002', 'local_a');
    assert.equal(res.status, 200);
    assert.deepEqual(via(res.body.todo), [['local_a', 'assigned']]);
    assert.deepEqual([stored().fin001.assigned, stored().fin002.assigned], [[], ['local_a']]);
    assert.deepEqual(via(await todo('fin001')), [['local_m', 'marker']], 'no ghost left on the old todo');
    assert.deepEqual([(await board('local_a')).todoId, (await board('local_a')).todoVia], ['fin002', 'assigned']);
    assert.equal(links().local_a.todoId, 'fin002');

    // not assigned to fin001 any more: nothing changes, the snapshot stays
    assert.equal((await unassign('fin001', 'local_a')).status, 200);
    assert.deepEqual(stored().fin002.assigned, ['local_a']);
    assert.equal(links().local_a.todoId, 'fin002');
});

test('unassign: gone from the todo and from links.json, so no 지난 세션 comes back', async () => {
    const res = await unassign('fin002', 'local_a');
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.todo.sessions, res.body.todo.status], [[], 'open']);
    assert.deepEqual(stored().fin002.assigned, []);
    assert.equal(Object.hasOwn(links(), 'local_a'), false);
    const listed = await todo('fin002');
    assert.deepEqual([listed.sessions, listed.status], [[], 'open']);
    assert.deepEqual([(await board('local_a')).todoId, (await board('local_a')).todoVia], [null, null]);
    assert.equal(Object.hasOwn(links(), 'local_a'), false, 'not written back by the next poll');
});

test('assign errors: marker session 409 (its own todo 200, nothing stored), unknown 404, bad id 400', async () => {
    assert.deepEqual(await assign('fin002', 'local_m'), { status: 409, body: { error: 'already linked' } });
    assert.deepEqual(stored().fin002.assigned, []);
    const own = await assign('fin001', 'local_m');
    assert.equal(own.status, 200);
    assert.deepEqual([stored().fin001.assigned, via(own.body.todo)], [[], [['local_m', 'marker']]]);

    assert.deepEqual(await assign('fin001', 'local_nope'), { status: 404, body: { error: 'unknown session' } });
    assert.deepEqual(await assign('zzzzzz', 'local_a'), { status: 404, body: { error: 'unknown todo' } });
    assert.deepEqual(await assign('fin001', 'local a'), { status: 400, body: { error: 'assign must be a session id' } });
    assert.deepEqual(await unassign('fin001', 'x'.repeat(81)), { status: 400, body: { error: 'unassign must be a session id' } });
    assert.deepEqual(await req('POST', '/api/todos', { title: 'x', folder: repo, assign: 'local_a' }), { status: 400, body: { error: 'unknown field: assign' } });
    // a failed assign writes nothing, other fields included
    assert.equal((await req('POST', '/api/todos/fin001', { title: '바뀌면 안 됨', assign: 'local_nope' })).status, 404);
    assert.equal(stored().fin001.title, '배정 1');
});

test('an off-board session can be assigned (lean view); confirming an assigned session finishes the todo', async () => {
    const old = await assign('fin002', 'local_old');
    assert.equal(old.status, 200);
    assert.deepEqual(old.body.todo.sessions.map(s => [s.id, s.status, s.column, s.via]), [['local_old', 'stale', null, 'assigned']]);
    assert.equal((await unassign('fin002', 'local_old')).status, 200);

    assert.equal((await assign('fin002', 'local_b')).status, 200);
    assert.equal((await req('POST', '/api/confirm/local_b')).status, 200);
    const done = await todo('fin002');
    assert.deepEqual([done.status, done.by, done.sessions[0].id, done.sessions[0].status, done.sessions[0].via], ['done', 'session', 'local_b', 'done', 'assigned']);
    assert.equal(done.doneAt, done.sessions[0].decidedAt);
});

const poll = async (until, tries = 100) => {
    const meeting = await get('/api/meeting');
    if (until(meeting) || tries <= 0) return meeting;
    await new Promise(r => setTimeout(r, 100));
    return poll(until, tries - 1);
};

test('회의실 narrate: 202 at once, running while the model works, a second press is `already`, then the note has it', async () => {
    // The fake model waits for the gate file, so the run is observably in progress.
    fakeClaude(`const out = () => process.stdout.write('1. **api**: 세션 배정을 붙였다.\\n2. **남은 것**\\n   1. 없음');
const wait = () => (fs.existsSync(${JSON.stringify(GATE)}) ? out() : setTimeout(wait, 50));
wait();`);
    const empty = await get('/api/meeting');
    assert.deepEqual(empty.narrative, { exists: false, text: '', writtenAt: null, running: false, startedAt: null, error: null });

    const first = await req('POST', '/api/meeting/narrate');
    assert.deepEqual(first, { status: 202, body: { ok: true, running: true, already: false } });
    const running = await get('/api/meeting');
    assert.deepEqual([running.narrative.running, running.narrative.exists, typeof running.narrative.startedAt], [true, false, 'number']);
    assert.deepEqual(await req('POST', '/api/meeting/narrate'), { status: 202, body: { ok: true, running: true, already: true } });

    fs.writeFileSync(GATE, '');
    const { narrative } = await poll(m => !m.narrative.running);
    assert.equal(narrative.running, false);
    assert.equal(narrative.error, null);
    assert.equal(narrative.exists, true);
    assert.match(narrative.text, /^## 어제 이야기 \(AI 서술 · .* · \d{2}:\d{2} 작성\)\n1\. \*\*api\*\*: 세션 배정을 붙였다\./);
    assert.equal(narrative.writtenAt, new Date(narrative.startedAt).setSeconds(0, 0));
    assert.equal(narrative.startedAt, running.narrative.startedAt);
    const narrations = calls().filter(c => c.system === NARRATIVE_SYSTEM);
    assert.equal(narrations.length, 1, 'the second press did not start another run');
    assert.match(narrations[0].input, /<session n="\d+">\n제목: local_a 세션\n/);
});

test('회의실 narrate: a failed model call ends the run with an error and keeps the old narrative', async () => {
    fakeClaude("process.stderr.write('not logged in'); process.exit(1);");
    const prev = (await get('/api/meeting')).narrative;
    assert.equal((await req('POST', '/api/meeting/narrate')).status, 202);
    const { narrative } = await poll(m => !m.narrative.running);
    assert.equal(narrative.running, false);
    assert.match(narrative.error, /not logged in|Command failed/);
    assert.deepEqual([narrative.exists, narrative.text, narrative.writtenAt], [true, prev.text, prev.writtenAt]);
    // the server is still up
    assert.equal((await get('/api/meeting')).narrative.running, false);
});

test('✨ refine: 200 with the cleaned suggestion, nothing saved; 404 unknown todo; 502 on a model failure', async () => {
    fakeClaude("process.stdout.write('```markdown\\n1. 목표\\n   1. 배정 기능 마무리\\n2. 할 일\\n   1. 확인 필요\\n```\\n');");
    const res = await req('POST', '/api/refine/fin001');
    assert.deepEqual(res, { status: 200, body: { ok: true, detail: '1. 목표\n   1. 배정 기능 마무리\n2. 할 일\n   1. 확인 필요' } });
    assert.equal((await todo('fin001')).detail, '원래 메모');
    assert.equal(stored().fin001.detail, '원래 메모');

    const call = calls().at(-1);
    assert.equal(call.system, REFINE_SYSTEM);
    assert.ok(call.input.startsWith(`<todo>\n제목: 배정 1\n세부:\n원래 메모\n프로젝트 폴더: ${repo}\n</todo>\n<sessions>\n<session n="1">\n제목: local_m 세션\n상태: 결재 대기\n`), call.input);
    assert.ok(call.input.includes('한 줄 요약: 배정 확인 완료\n다음 작업: 후속 작업\n</session>'));
    // today's narrative (written above) rides along
    assert.match(call.input, /<narrative>\n## 어제 이야기 \(AI 서술[\s\S]*세션 배정을 붙였다[\s\S]*<\/narrative>\n/);
    assert.ok(!call.input.includes(NARRATIVE_START));

    assert.deepEqual(await req('POST', '/api/refine/zzzzzz'), { status: 404, body: { error: 'unknown todo' } });
    fakeClaude("process.stderr.write('boom'); process.exit(1);");
    assert.deepEqual(await req('POST', '/api/refine/fin001'), { status: 502, body: { error: '다듬지 못했어요' } });
    // an empty answer is no suggestion either
    fakeClaude("process.stdout.write('  \\n');");
    assert.deepEqual(await req('POST', '/api/refine/fin001'), { status: 502, body: { error: '다듬지 못했어요' } });
});

test('new POSTs need our Origin', async () => {
    const evil = { origin: 'http://evil.test' };
    assert.equal((await fetch(`${origin}/api/meeting/narrate`, { method: 'POST', headers: evil })).status, 403);
    assert.equal((await fetch(`${origin}/api/refine/fin001`, { method: 'POST', headers: evil })).status, 403);
    const res = await fetch(`${origin}/api/todos/fin001`, { method: 'POST', headers: { ...evil, 'content-type': 'application/json' }, body: JSON.stringify({ assign: 'local_a' }) });
    assert.equal(res.status, 403);
    assert.deepEqual(stored().fin001.assigned, []);
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
