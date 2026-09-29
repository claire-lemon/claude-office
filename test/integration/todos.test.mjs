import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Own fixture home and ports (office.test.mjs uses 7794-7798; files run in parallel). config.mjs reads env
// at import time, so this is set before the dynamic imports below.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-todos-'));
process.env.OFFICE_HOME = HOME;
const { transcriptPathFor } = await import('../../src/sources/transcripts.mjs');
const { markerLine } = await import('../../src/domain/todo.mjs');
const { TODO_FOLDERS_LIMIT } = await import('../../src/config.mjs');

const NOW = Date.now();
const DAYS = n => n * 24 * 3600 * 1000;
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(HOME, '.claude/office/state');
const DECISIONS = path.join(HOME, '.claude/office/decisions.json');
const TODOS = path.join(HOME, '.claude/office/todos.json');
const LINKS = path.join(HOME, '.claude/office/links.json');
[APP, STATE, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const dir = name => {
    const d = path.join(HOME, 'repos', name);
    fs.mkdirSync(d, { recursive: true });
    return d;
};
const app = (id, cli, folder, lastActivityAt, title = id) =>
    fs.writeFileSync(
        path.join(APP, `${id}.json`),
        JSON.stringify({ sessionId: id, cliSessionId: cli, title, cwd: folder, originCwd: folder, lastActivityAt, isArchived: false, prs: [] }),
    );
const state = (cli, event, at, transcriptPath) => fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event, at, cwd: repoA, transcriptPath }));
const userLine = content => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
const assistantLine = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const decisions = () => (fs.existsSync(DECISIONS) ? JSON.parse(fs.readFileSync(DECISIONS, 'utf8')) : {});
const REPORT = '## 결재 보고\n### 한 줄 요약\n1. 연결 확인 완료\n### 다음 작업\n1. 후속 작업\n   1. 이어서 필요';

const repoA = dir('api');
const repoB = dir('web');
const extras = Array.from({ length: 22 }, (_, i) => dir(`extra-${String(i).padStart(2, '0')}`));
const tA = path.join(HOME, 't', 'cli-a.jsonl');
app('local_a', 'cli-a', repoA, NOW - 60_000, 'A 세션');
state('cli-a', 'Stop', NOW - 30_000, tA);
app('local_b', 'cli-b', repoB, NOW - 120_000);
app('local_gone', 'cli-gone', path.join(HOME, 'no-such-repo'), NOW - 10_000); // newest, but its folder is gone
app('local_old', 'cli-old', repoA, NOW - DAYS(3)); // off the board: no hook state, 3 days old
app('local_arch', 'cli-arch', repoA, NOW - DAYS(3));
extras.forEach((d, i) => app(`local_x${i}`, `cli-x${i}`, d, NOW - DAYS(4) - i * 1000));

const PORT = '7792';
const origin = `http://127.0.0.1:${PORT}`;
const server = { proc: null };
const start = async () => {
    server.proc = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...process.env, OFFICE_HOME: HOME, OFFICE_DRY: '1', OFFICE_PORT: PORT } });
    await new Promise((resolve, reject) => {
        server.proc.stdout.once('data', resolve);
        server.proc.once('exit', code => reject(new Error(`server exited ${code}`)));
    });
};
// A fresh process drops the transcript head cache: what survives is on disk (links.json) only.
const restart = async () => {
    server.proc.kill();
    await once(server.proc, 'exit');
    await start();
};
before(start);
after(() => server.proc?.kill());

const req = (method, p, body, headers = {}) =>
    fetch(`${origin}${p}`, {
        method,
        headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
const json = async res => ({ status: res.status, body: await res.json() });
const list = () => fetch(`${origin}/api/todos`).then(r => r.json());
const todoById = async id => (await list()).todos.find(t => t.id === id);
const sessions = () => fetch(`${origin}/api/sessions`).then(r => r.json()).then(j => j.sessions);
const create = async body => (await json(await req('POST', '/api/todos', body))).body.todo;

test('create -> list -> update -> delete -> deleted list -> restore', async () => {
    const created = await json(await req('POST', '/api/todos', { title: '  결제\n모듈 ', folder: `${repoA}/` }));
    assert.equal(created.status, 201);
    assert.equal(created.body.ok, true);
    const { id, createdAt, ...rest } = created.body.todo;
    assert.match(id, /^[a-z0-9]{6}$/);
    assert.equal(typeof createdAt, 'number');
    assert.deepEqual(rest, {
        title: '결제 모듈', detail: '', folder: repoA, source: 'manual', manual: null, deletedAt: null, assigned: [],
        project: 'api', status: 'open', doneAt: null, by: null, sessions: [], latest: null,
    });
    assert.ok((await list()).todos.some(t => t.id === id));
    // only what the user wrote is stored; status/sessions are computed per request
    const stored = JSON.parse(fs.readFileSync(path.join(HOME, '.claude/office/todos.json'), 'utf8'))[id];
    assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'deletedAt', 'detail', 'folder', 'manual', 'source', 'title']);

    const edited = await json(await req('POST', `/api/todos/${id}`, { title: '결제 모듈 v2', detail: '1줄\n2줄', folder: repoB }));
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.body.todo.title, edited.body.todo.detail, edited.body.todo.folder, edited.body.todo.project], ['결제 모듈 v2', '1줄\n2줄', repoB, 'web']);

    const done = (await json(await req('POST', `/api/todos/${id}`, { done: true }))).body.todo;
    assert.deepEqual([done.status, done.by, done.doneAt, done.manual.state], ['done', 'manual', done.manual.at, 'done']);
    assert.equal((await todoById(id)).status, 'done');
    const reopened = (await json(await req('POST', `/api/todos/${id}`, { done: false }))).body.todo;
    assert.deepEqual([reopened.status, reopened.by, reopened.doneAt], ['open', 'manual', null]);

    // a full 2000-char Korean detail fits the todo body limit (the 4KB default would 413 it)
    const long = await json(await req('POST', `/api/todos/${id}`, { detail: '가'.repeat(2000) }));
    assert.equal(long.status, 200);
    assert.equal([...long.body.todo.detail].length, 2000);

    assert.deepEqual(await json(await req('DELETE', `/api/todos/${id}`)), { status: 200, body: { ok: true } });
    const afterDelete = await list();
    assert.equal(afterDelete.todos.some(t => t.id === id), false);
    assert.deepEqual(afterDelete.deleted, [{ id, title: '결제 모듈 v2' }]);

    const restored = await json(await req('POST', `/api/todos/${id}`, { deleted: false }));
    assert.equal(restored.status, 200);
    assert.equal(restored.body.todo.deletedAt, null);
    const afterRestore = await list();
    assert.ok(afterRestore.todos.some(t => t.id === id));
    assert.deepEqual(afterRestore.deleted, []);

    assert.deepEqual(await json(await req('POST', '/api/todos/zzzzzz', { done: true })), { status: 404, body: { error: 'unknown todo' } });
    assert.deepEqual(await json(await req('DELETE', '/api/todos/zzzzzz')), { status: 404, body: { error: 'unknown todo' } });
    assert.deepEqual(await json(await req('DELETE', '/api/todos')), { status: 404, body: { error: 'unknown todo' } });
});

test('bad bodies: 400 with the reason, 413 / 415 from readJsonBody', async () => {
    const t = await create({ title: '검증', folder: repoA });
    const file = path.join(repoA, 'file.txt');
    fs.writeFileSync(file, 'x');
    const bad = async (p, body, error) => assert.deepEqual(await json(await req('POST', p, body)), { status: 400, body: { error } }, `${p} ${JSON.stringify(body)}`);
    await bad('/api/todos', { folder: repoA }, 'title required');
    await bad('/api/todos', { title: ' \n ', folder: repoA }, 'title required');
    await bad('/api/todos', { title: 'x' }, 'folder required');
    await bad('/api/todos', { title: 'x', folder: 'repos/api' }, 'folder must be an absolute path');
    await bad('/api/todos', { title: 'x', folder: path.join(HOME, 'nope') }, 'folder not found');
    await bad('/api/todos', { title: 'x', folder: file }, 'folder not found');
    await bad('/api/todos', { title: 'x', folder: repoA, color: 'red' }, 'unknown field: color');
    await bad('/api/todos', { title: 'x', folder: repoA, done: true }, 'unknown field: done');
    await bad('/api/todos', [], 'body must be an object');
    await bad('/api/todos', 'not json', 'bad json');
    await bad(`/api/todos/${t.id}`, {}, 'empty patch');
    await bad(`/api/todos/${t.id}`, { title: '' }, 'title required');
    await bad(`/api/todos/${t.id}`, { title: 1 }, 'title must be a string');
    await bad(`/api/todos/${t.id}`, { done: 'yes' }, 'done must be a boolean');
    await bad(`/api/todos/${t.id}`, { deleted: true }, 'deleted must be false');
    await bad(`/api/todos/${t.id}`, { folder: path.join(HOME, 'nope') }, 'folder not found');
    assert.deepEqual(await json(await req('POST', '/api/todos', { title: 'x', folder: repoA }, { 'content-type': 'text/plain' })), { status: 415, body: { error: 'json only' } });
    assert.deepEqual(await json(await req('POST', '/api/todos', { title: 'x', folder: repoA, detail: 'x'.repeat(20000) })), { status: 413, body: { error: 'too large' } });
    assert.equal((await todoById(t.id)).title, '검증');
});

test('folders: existing app-session repo folders, newest first, once each, capped', async () => {
    const { folders } = await list();
    assert.equal(folders.length, TODO_FOLDERS_LIMIT);
    assert.deepEqual(folders.map(f => f.path), [repoA, repoB, ...extras.slice(0, TODO_FOLDERS_LIMIT - 2)]);
    // lastAt = the newest of the session activity and the 칠판 todos made there (earlier tests made some)
    assert.deepEqual([folders[0].path, folders[0].name], [repoA, 'api']);
    assert.ok(folders[0].lastAt >= NOW - 60_000);
});

test('start (dry run): new-session link with the folder and the marker as the first line', async () => {
    const t = await create({ title: '시작 테스트', detail: '세부 메모', folder: repoA });
    const res = await json(await req('POST', `/api/start/${t.id}`));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.opened, /^claude:\/\/code\/new\?q=.+&folder=/);
    const url = new URL(res.body.opened.replace('claude://', 'http://'));
    assert.equal(url.searchParams.get('folder'), repoA);
    assert.equal(url.searchParams.get('q'), [markerLine(t.id, '시작 테스트'), '세부 메모', `- 프로젝트: ${repoA}`, '끝나면 결재 보고로 마무리해줘.'].join('\n'));
    // starting marks nothing: the todo stays open until its session shows up
    assert.equal((await todoById(t.id)).status, 'open');

    assert.deepEqual(await json(await req('POST', '/api/start/zzzzzz')), { status: 404, body: { error: 'unknown todo' } });
    const gone = await create({ title: '폴더 삭제', folder: dir('soon-gone') });
    fs.rmSync(gone.folder, { recursive: true });
    assert.deepEqual(await json(await req('POST', `/api/start/${gone.id}`)), { status: 404, body: { error: 'repo folder not found' } });
    await req('DELETE', `/api/todos/${t.id}`);
    assert.deepEqual(await json(await req('POST', `/api/start/${t.id}`)), { status: 404, body: { error: 'unknown todo' } });
});

test('a marker in the first prompt links the session; decisions and manual checks drive the status', async () => {
    const t = await create({ title: '연결 테스트', folder: repoA });
    // the head is read before the first prompt line lands; it must be re-read once the file grows
    fs.writeFileSync(tA, `${JSON.stringify({ type: 'file-history-snapshot' })}\n`);
    assert.equal((await todoById(t.id)).status, 'open');
    fs.appendFileSync(tA, userLine(`${markerLine(t.id, t.title)}\n- 프로젝트: ${repoA}`) + assistantLine(REPORT));

    const linked = await todoById(t.id);
    assert.deepEqual([linked.status, linked.by, linked.doneAt], ['started', 'session', null]);
    assert.equal(linked.sessions.length, 1);
    const [s] = linked.sessions;
    assert.deepEqual([s.id, s.title, s.status, s.column, s.decidedAt, s.lastAt], ['local_a', 'A 세션', 'review', 'pending', null, NOW - 30_000]);
    assert.equal(typeof s.animal, 'string');
    assert.equal(linked.latest.id, 'local_a');

    const board = await sessions();
    assert.ok(board.every(x => Object.hasOwn(x, 'todoId') && Object.hasOwn(x, 'decidedAt')));
    assert.deepEqual(['local_a', 'local_b'].map(id => board.find(x => x.id === id)).map(x => [x.todoId, x.decidedAt]), [[t.id, null], [null, null]]);

    const step = async (action, expected) => {
        assert.equal((await req('POST', `/api/${action}/local_a`)).status, 200, action);
        const v = await todoById(t.id);
        assert.deepEqual([v.status, v.by, v.sessions[0].status], expected, action);
        return v;
    };
    const held = await step('hold', ['started', 'session', 'hold']);
    assert.equal(held.sessions[0].decidedAt, decisions().local_a.at);
    assert.equal((await sessions()).find(x => x.id === 'local_a').decidedAt, decisions().local_a.at);
    const confirmed = await step('confirm', ['done', 'session', 'done']);
    assert.equal(confirmed.doneAt, decisions().local_a.at);
    const undone = await step('undo', ['started', 'session', 'review']);
    assert.equal(undone.doneAt, null);
    // archived = off the board, so the link is the lean view
    const archived = await step('archive', ['done', 'session', 'archived']);
    assert.deepEqual([archived.doneAt, archived.sessions[0].column], [decisions().local_a.at, null]);
    assert.equal((await sessions()).some(x => x.id === 'local_a'), false);
    await step('restore', ['started', 'session', 'hold']);

    // a manual check newer than the session wins...
    const manual = (await json(await req('POST', `/api/todos/${t.id}`, { done: true }))).body.todo;
    assert.deepEqual([manual.status, manual.by, manual.doneAt], ['done', 'manual', manual.manual.at]);
    assert.deepEqual([(await todoById(t.id)).status, (await todoById(t.id)).by], ['done', 'manual']);
    // ...until the session does something newer
    await new Promise(r => setTimeout(r, 5));
    state('cli-a', 'UserPromptSubmit', Date.now(), tA);
    const resumed = await todoById(t.id);
    assert.deepEqual([resumed.status, resumed.by, resumed.sessions[0].status], ['started', 'session', 'working']);

    // 다음 작업 ▶ 진행 hands the marker on to the follow-up session
    const next = await json(await req('POST', '/api/next/local_a?index=0'));
    assert.equal(next.status, 200);
    const q = new URL(next.body.opened.replace('claude://', 'http://')).searchParams.get('q');
    assert.ok(q.startsWith(`${markerLine(t.id, '연결 테스트')}\n\n이전 세션 "A 세션"`), q);
});

test('sessions off the board still link: an old one reads stale (started), an archived one done', async () => {
    const stale = await create({ title: '예전 세션', folder: repoA });
    const arch = await create({ title: '아카이브 세션', folder: repoA });
    const put = (cli, id) => {
        const file = transcriptPathFor(repoA, cli);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, userLine(markerLine(id, 'x')));
    };
    put('cli-old', stale.id);
    put('cli-arch', arch.id);
    const archivedAt = Date.now();
    fs.writeFileSync(DECISIONS, JSON.stringify({ ...decisions(), local_arch: { kind: 'archive', at: archivedAt, title: 'x' } }));

    const s = await todoById(stale.id);
    assert.deepEqual([s.status, s.by], ['started', 'session']);
    assert.deepEqual(s.sessions, [{ id: 'local_old', title: 'local_old', animal: s.sessions[0].animal, status: 'stale', column: null, lastAt: NOW - DAYS(3), decidedAt: null, via: 'marker' }]);
    const a = await todoById(arch.id);
    assert.deepEqual([a.status, a.by, a.doneAt, a.sessions[0].status, a.sessions[0].column], ['done', 'session', archivedAt, 'archived', null]);
    const board = await sessions();
    assert.equal(board.some(x => x.id === 'local_old' || x.id === 'local_arch'), false);
});

test('non-GET requests need our Origin (DELETE included)', async () => {
    const t = await create({ title: 'Origin', folder: repoA });
    assert.equal((await req('DELETE', `/api/todos/${t.id}`, undefined, { origin: 'http://evil.test' })).status, 403);
    assert.equal((await fetch(`${origin}/api/todos/${t.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await req('POST', '/api/todos', { title: 'x', folder: repoA }, { origin: 'http://evil.test' })).status, 403);
    assert.equal((await req('POST', `/api/start/${t.id}`, undefined, { origin: 'http://evil.test' })).status, 403);
    assert.ok(await todoById(t.id));
});

const links = () => JSON.parse(fs.readFileSync(LINKS, 'utf8'));
const linkedSession = (id, cli, event, at, todo) => {
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, userLine(markerLine(todo.id, todo.title)) + assistantLine(REPORT));
    app(id, cli, repoA, at, `${id} 세션`);
    state(cli, event, at, file);
    return file;
};

test('연결 기록: links.json keeps links after the transcript is gone (30-day cleanup regression)', async () => {
    const finished = await create({ title: '기록 완료', folder: repoA });
    const working = await create({ title: '기록 작업 중', folder: repoA });
    const tH1 = linkedSession('local_h1', 'cli-h1', 'Stop', Date.now() - 20_000, finished);
    const tH2 = linkedSession('local_h2', 'cli-h2', 'UserPromptSubmit', Date.now() - 10_000, working);
    assert.equal((await req('POST', '/api/confirm/local_h1')).status, 200);
    const confirmedAt = decisions().local_h1.at;
    const first = { done: await todoById(finished.id), working: await todoById(working.id) };
    assert.deepEqual([first.done.status, first.done.doneAt, first.working.status, first.working.sessions[0].status], ['done', confirmedAt, 'started', 'working']);

    // only the snapshot fields are stored (no branch / prs / report)
    const seen = links();
    assert.deepEqual(seen.local_h1, {
        todoId: finished.id, via: 'marker', title: 'local_h1 세션', animal: first.done.sessions[0].animal, status: 'done', decidedAt: confirmedAt,
        lastAt: first.done.sessions[0].lastAt, seenAt: seen.local_h1.seenAt,
    });
    assert.deepEqual([seen.local_h2.todoId, seen.local_h2.status], [working.id, 'working']);

    // polling while only lastAt moves: the file is not rewritten
    const mtime = fs.statSync(LINKS).mtimeMs;
    state('cli-h2', 'UserPromptSubmit', Date.now(), tH2);
    const polled = await todoById(working.id);
    await list();
    assert.ok(polled.sessions[0].lastAt > first.working.sessions[0].lastAt);
    assert.equal(fs.statSync(LINKS).mtimeMs, mtime);
    assert.deepEqual(links(), seen);

    // Claude Code's cleanup: transcripts deleted, the done session's app file and hook state gone too
    [tH1, tH2, path.join(APP, 'local_h1.json'), path.join(STATE, 'cli-h1.json')].forEach(f => fs.rmSync(f));
    await restart();
    assert.equal((await sessions()).find(x => x.id === 'local_h2').todoId, null, 'the marker is really unreadable now');

    const done = await todoById(finished.id);
    assert.deepEqual([done.status, done.by, done.doneAt], ['done', 'session', confirmedAt]);
    assert.deepEqual(done.sessions, [{ id: 'local_h1', title: 'local_h1 세션', animal: seen.local_h1.animal, status: 'done', column: 'done', lastAt: seen.local_h1.lastAt, decidedAt: confirmedAt, via: 'marker' }]);
    const cut = await todoById(working.id);
    assert.deepEqual([cut.status, cut.by, cut.sessions.length, cut.sessions[0].id, cut.sessions[0].status, cut.sessions[0].column], ['started', 'session', 1, 'local_h2', 'stale', null]);
    // the vanished snapshot is read, not rewritten
    assert.deepEqual(links(), seen);
});

test('GET /api/todo-history: done before today and deleted todos, latest first; GET /api/todos shape unchanged', async () => {
    const d = new Date(NOW);
    const yesterday = h => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h).getTime();
    const open = await create({ title: '오늘 할 일', folder: repoA });
    const record = (title, extra) => ({ title, detail: '', folder: repoA, createdAt: yesterday(9), source: 'manual', manual: null, deletedAt: null, ...extra });
    fs.writeFileSync(
        TODOS,
        JSON.stringify({
            ...JSON.parse(fs.readFileSync(TODOS, 'utf8')),
            ydone1: record('어제 끝낸 일', { manual: { state: 'done', at: yesterday(12) } }),
            ydel01: record('어제 지운 일', { deletedAt: yesterday(15) }),
        }),
    );
    const res = await fetch(`${origin}/api/todo-history`);
    assert.equal(res.status, 200);
    const { todos, ...rest } = await res.json();
    assert.deepEqual(rest, {});
    const ids = todos.map(t => t.id);
    assert.deepEqual(ids.filter(id => ['ydone1', 'ydel01'].includes(id)), ['ydel01', 'ydone1']);
    assert.ok(!ids.includes(open.id), "today's open todo stays on the 칠판");
    const ydone = todos.find(t => t.id === 'ydone1');
    assert.deepEqual([ydone.status, ydone.by, ydone.doneAt, ydone.project, ydone.sessions, ydone.latest], ['done', 'manual', yesterday(12), 'api', [], null]);
    assert.equal(todos.find(t => t.id === 'ydel01').deletedAt, yesterday(15));
    // sorted by the moment it ended, newest first
    const ended = todos.map(t => t.doneAt || t.deletedAt);
    assert.deepEqual(ended, [...ended].sort((a, b) => b - a));

    const board = await list();
    assert.deepEqual(Object.keys(board), ['todos', 'deleted', 'folders']);
    assert.ok(!board.todos.some(t => ['ydone1', 'ydel01'].includes(t.id)));
    assert.ok(!board.deleted.some(t => t.id === 'ydel01'), 'only today\'s deletes are offered for 되돌리기');
});
