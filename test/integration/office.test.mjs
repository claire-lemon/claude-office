import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
process.env.OFFICE_HOME = HOME;
const { listSessions } = await import('../../src/usecases/list-sessions.mjs');
const { getChanges } = await import('../../src/usecases/get-changes.mjs');
const { gitInfo } = await import('../../src/sources/git.mjs');
const env = { ...process.env, OFFICE_HOME: HOME };
const hook = input =>
    spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], { env, input: typeof input === 'string' ? input : JSON.stringify(input) });
const TITLE_1 = '인프라 구조 정리';
const stateOf = id => JSON.parse(fs.readFileSync(path.join(HOME, '.claude/office/state', `${id}.json`), 'utf8'));

test('hook: silent, exit 0 on garbage, ignores idle Notification after Stop', () => {
    const bad = hook('not json');
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout.length, 0);
    const ok = hook({ session_id: 'h1', hook_event_name: 'UserPromptSubmit', cwd: '/x' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout.length, 0);
    hook({ session_id: 'h1', hook_event_name: 'Notification', message: 'permission' });
    assert.equal(stateOf('h1').event, 'Notification');
    hook({ session_id: 'h1', hook_event_name: 'Stop' });
    hook({ session_id: 'h1', hook_event_name: 'Notification', message: 'idle' });
    assert.equal(stateOf('h1').event, 'Stop');
    hook({ session_id: '../evil', hook_event_name: 'Stop' });
    assert.ok(!fs.existsSync(path.join(HOME, '.claude/office/evil.json')));
});

test('buildSessions + diff on simulated office', () => {
    execFileSync('node', [path.join(ROOT, 'scripts/simulate.mjs'), '--once'], { env });
    const sessions = listSessions();
    // The hook test above leaves state-only sessions too; the old 10-desk cap used to hide them.
    assert.equal(sessions.filter(s => s.id.startsWith('local_')).length, 10);
    const byId = Object.fromEntries(sessions.map(s => [s.id, s]));
    assert.equal(byId.local_0.status, 'working');
    assert.equal(byId.local_1.status, 'review');
    assert.equal(byId.local_1.report['한 줄 요약'].includes('workspace$'), true);
    assert.equal(byId.local_2.status, 'blocked');
    assert.equal(byId.local_3.status, 'question');
    assert.equal(byId.local_0.link, 'claude://claude.ai/epitaxy/local_0');
    const d = getChanges(byId.local_0);
    assert.equal(d.tracked, true);
    assert.deepEqual(d.files.map(f => f.path), ['views.ts', 'new-file.md']); // tracked diff + new-file.md now shown as added
    assert.deepEqual(d.untracked, ['new-file.md']);
    assert.equal(getChanges(byId.local_1).tracked, false);
    assert.deepEqual(gitInfo(path.join(HOME, 'repo')), { project: 'repo', branch: 'feat/x' });
    assert.equal(byId.local_0.cwd.endsWith('/repo'), true);
    assert.equal(byId.local_0.diffStat, null);
    hook({ session_id: 'cli-0', hook_event_name: 'Stop' });
    const stopped = listSessions().find(s => s.id === 'local_0');
    assert.deepEqual(stopped.diffStat, { files: 2, add: 2, del: 0 }); // includes the untracked new-file.md
});

test('install is idempotent, keeps foreign hooks and rules, drops the old facilitator read rules, uninstall removes only ours', () => {
    const settings = path.join(HOME, '.claude/settings.json');
    const foreign = { permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, model: 'x' };
    const office = path.join(HOME, '.claude/office');
    const oldReads = [`Read(/${office}/CLAUDE.md)`, `Read(/${office}/daily/**)`]; // what the 회의실 version added
    fs.writeFileSync(settings, JSON.stringify({ ...foreign, permissions: { ...foreign.permissions, allow: ['Bash(ls)', ...oldReads] } }));
    const run = (...a) => execFileSync('node', [path.join(ROOT, 'install.mjs'), ...a], { env });
    run();
    run();
    const installed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.equal(installed.hooks.Stop.length, 2);
    assert.equal(installed.hooks.UserPromptSubmit.length, 1);
    assert.deepEqual(installed.permissions.allow, ['Bash(ls)']);
    assert.deepEqual(installed.permissions.deny, ['Read(./.env)']);
    run('--uninstall');
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), foreign);
    fs.writeFileSync(settings, JSON.stringify({ model: 'x' }));
    run();
    run('--uninstall');
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { model: 'x' }); // no empty permissions/hooks left behind
});

test('server: confirm hands off instruction, next opens a prefilled new session (dry run)', async () => {
    const { spawn } = await import('node:child_process');
    const port = '7798';
    const server = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...env, OFFICE_DRY: '1', OFFICE_PORT: port } });
    await new Promise(r => server.stdout.once('data', r));
    const origin = `http://127.0.0.1:${port}`;
    const post = p => fetch(`${origin}${p}`, { method: 'POST', headers: { origin } });
    try {
        const list = await fetch(`${origin}/api/sessions`).then(r => r.json());
        const s1 = list.sessions.find(s => s.id === 'local_1');
        assert.equal(s1.nextTasks.length, 3);

        const bad = await fetch(`${origin}/api/confirm/local_1`, { method: 'POST', headers: { origin: 'http://evil.test' } });
        assert.equal(bad.status, 403);

        const c = await post('/api/confirm/local_1').then(r => r.json());
        assert.match(c.copied, /커밋[\s\S]*PR[\s\S]*다음 작업/);
        assert.equal(c.opened, 'claude://claude.ai/epitaxy/local_1');

        const n = await post('/api/next/local_1?index=1').then(r => r.json());
        const q = decodeURIComponent(new URL(n.opened.replace('claude://', 'http://')).searchParams.get('q'));
        assert.match(n.opened, /^claude:\/\/code\/new\?q=.+&folder=/);
        assert.match(q, /할 일: 프론트\(my-web\)에서 `workspace\$` 표시/);
        assert.equal((await post('/api/next/local_1?index=9')).status, 404);
    } finally {
        server.kill();
    }
});

test('hold / archive / restore through the server', async () => {
    const { spawn } = await import('node:child_process');
    const port = '7797';
    const server = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...env, OFFICE_DRY: '1', OFFICE_PORT: port } });
    await new Promise(r => server.stdout.once('data', r));
    const origin = `http://127.0.0.1:${port}`;
    const post = p => fetch(`${origin}${p}`, { method: 'POST', headers: { origin } });
    const sessions = () => fetch(`${origin}/api/sessions`).then(r => r.json()).then(j => j.sessions);
    try {
        assert.equal((await post('/api/hold/local_3')).status, 200);
        assert.equal((await sessions()).find(s => s.id === 'local_3').status, 'hold');

        assert.equal((await post('/api/archive/local_1')).status, 200);
        assert.equal((await sessions()).some(s => s.id === 'local_1'), false);
        const { archived } = await fetch(`${origin}/api/archived`).then(r => r.json());
        const row = archived.find(a => a.id === 'local_1');
        assert.equal(row.title, TITLE_1);
        assert.match(row.summary, /workspace\$/);
        assert.ok(row.lastAt);

        assert.equal((await post('/api/restore/local_1')).status, 200);
        assert.equal((await sessions()).find(s => s.id === 'local_1').status, 'hold');
        assert.equal((await fetch(`${origin}/api/archived`).then(r => r.json())).archived.length, 0);
        assert.equal((await post('/api/restore/local_1')).status, 404);

        assert.equal((await post('/api/undo/local_1')).status, 200);
        assert.equal((await sessions()).find(s => s.id === 'local_1').status, 'review');
    } finally {
        server.kill();
    }
});

test('server: board moves (hold -> done -> undo) and title edits', async () => {
    const { spawn } = await import('node:child_process');
    const port = '7794';
    const server = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...env, OFFICE_DRY: '1', OFFICE_PORT: port } });
    await new Promise(r => server.stdout.once('data', r));
    const origin = `http://127.0.0.1:${port}`;
    const post = (p, init = {}) => fetch(`${origin}${p}`, { method: 'POST', ...init, headers: { origin, ...init.headers } });
    const move = (id, to) => post(`/api/move/${id}?to=${to}`);
    const edit = (id, body, headers = { 'content-type': 'application/json' }) =>
        post(`/api/edit/${id}`, { headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const byId = id => fetch(`${origin}/api/sessions`).then(r => r.json()).then(j => j.sessions.find(s => s.id === id));
    const json = async res => ({ status: res.status, body: await res.json() });
    try {
        const s6 = await byId('local_6');
        assert.equal(s6.status, 'review');
        assert.equal(s6.column, 'pending');
        assert.equal(s6.title, s6.appTitle);
        const ARCHIVE = { to: 'archive', action: 'archive' };
        assert.deepEqual(s6.moves, [{ to: 'hold', action: 'hold' }, { to: 'done', action: 'confirm' }, ARCHIVE]);

        assert.deepEqual(await json(await move('local_6', 'hold')), { status: 200, body: { ok: true, action: 'hold' } });
        const held = await byId('local_6');
        assert.equal(held.column, 'hold');
        assert.deepEqual(held.moves, [{ to: 'done', action: 'confirm' }, { to: 'pending', action: 'undo' }, ARCHIVE]);

        // 완료 by drag = decision only (no clipboard/chat hand-off, unlike /api/confirm)
        assert.deepEqual(await json(await move('local_6', 'done')), { status: 200, body: { ok: true, action: 'confirm' } });
        const done = await byId('local_6');
        assert.equal(done.column, 'done');
        assert.deepEqual(done.moves, [{ to: 'hold', action: 'hold' }, { to: 'pending', action: 'undo' }, ARCHIVE]);

        assert.deepEqual(await json(await move('local_6', 'pending')), { status: 200, body: { ok: true, action: 'undo' } });
        const back = await byId('local_6');
        assert.equal(back.status, 'review');
        assert.equal(back.column, 'pending');

        // dropped on the 보관함 button: same as the archive button (off the board, listed in 보관함)
        assert.deepEqual(await json(await move('local_6', 'archive')), { status: 200, body: { ok: true, action: 'archive' } });
        assert.equal(await byId('local_6'), undefined);
        const { archived } = await fetch(`${origin}/api/archived`).then(r => r.json());
        assert.equal(archived.find(a => a.id === 'local_6')?.title, back.title);
        assert.equal((await post('/api/restore/local_6')).status, 200);

        // a working card can't be confirmed, and nothing moves into its own column
        const s5 = await byId('local_5');
        assert.equal(s5.column, 'working');
        assert.deepEqual(s5.moves, [{ to: 'hold', action: 'hold' }, ARCHIVE]);
        assert.deepEqual(await json(await move('local_5', 'done')), { status: 409, body: { error: 'move not allowed', moves: s5.moves } });
        assert.equal((await move('local_5', 'working')).status, 409);
        assert.equal((await post('/api/move/local_5')).status, 409);
        assert.equal((await byId('local_5')).column, 'working');
        assert.deepEqual(await json(await move('nope', 'hold')), { status: 404, body: { error: 'unknown session' } });

        const s9 = await byId('local_9');
        const appTitle = s9.appTitle;
        assert.deepEqual(await json(await edit('local_9', { title: '  결제 모듈\n리팩터링  ' })), {
            status: 200,
            body: { ok: true, title: '결제 모듈 리팩터링', appTitle },
        });
        const renamed = await byId('local_9');
        assert.equal(renamed.title, '결제 모듈 리팩터링');
        assert.equal(renamed.appTitle, appTitle);

        assert.deepEqual(await json(await edit('local_9', { title: '' })), { status: 200, body: { ok: true, title: appTitle, appTitle } });
        assert.equal((await byId('local_9')).title, appTitle);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(HOME, '.claude/office/overrides.json'), 'utf8')), {});

        assert.deepEqual(await json(await edit('local_9', { color: 'red' })), { status: 400, body: { error: 'unknown field: color' } });
        assert.deepEqual(await json(await edit('local_9', { title: 123 })), { status: 400, body: { error: 'title must be a string' } });
        assert.deepEqual(await json(await edit('local_9', 'not json')), { status: 400, body: { error: 'bad json' } });
        assert.deepEqual(await json(await edit('local_9', { title: 'x' }, {})), { status: 415, body: { error: 'json only' } });
        assert.deepEqual(await json(await edit('local_9', { title: 'x'.repeat(5000) })), { status: 413, body: { error: 'too large' } });
        assert.deepEqual(await json(await edit('nope', { title: 'x' })), { status: 404, body: { error: 'unknown session' } });
        const foreign = { 'content-type': 'application/json', origin: 'http://evil.test' };
        assert.equal((await edit('local_9', { title: 'x' }, foreign)).status, 403);
        assert.equal((await post('/api/move/local_5?to=hold', { headers: { origin: 'http://evil.test' } })).status, 403);
        assert.equal((await byId('local_9')).title, appTitle);
    } finally {
        server.kill();
    }
});

test('summarizer runs isolated: no tools, no persistence, no hooks, temp cwd', async () => {
    const { spawn } = await import('node:child_process');
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'office-fakeclaude-'));
    const log = path.join(bin, 'call.json');
    // Fake `claude`: records how it was called and prints a canned report.
    fs.writeFileSync(
        path.join(bin, 'claude'),
        `#!/usr/bin/env node
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), skip: process.env.OFFICE_SKIP_HOOK, cwd: process.cwd(), input }));
process.stdout.write('## 결재 보고\\n### 한 줄 요약\\n1. 요약 완료\\n');
`,
        { mode: 0o755 },
    );
    const port = '7796';
    const server = spawn('node', [path.join(ROOT, 'server.mjs')], {
        env: { ...env, OFFICE_DRY: '1', OFFICE_PORT: port, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    await new Promise(r => server.stdout.once('data', r));
    const origin = `http://127.0.0.1:${port}`;
    try {
        const res = await fetch(`${origin}/api/summary/local_3`, { method: 'POST', headers: { origin } }).then(r => r.json());
        assert.match(res.summary, /요약 완료/);
        const call = JSON.parse(fs.readFileSync(log, 'utf8'));
        assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
        assert.ok(call.args.includes('--no-session-persistence'));
        assert.ok(call.args.includes('--system-prompt'));
        assert.equal(call.skip, '1');
        assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(os.tmpdir()));
        assert.match(call.input, /<transcript>[\s\S]*<\/transcript>/);
    } finally {
        server.kill();
    }
});

test('hook does nothing when OFFICE_SKIP_HOOK is set', () => {
    const r = spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], {
        env: { ...env, OFFICE_SKIP_HOOK: '1' },
        input: JSON.stringify({ session_id: 'skipme', hook_event_name: 'Stop' }),
    });
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(path.join(HOME, '.claude/office/state', 'skipme.json')));
});

test('server rejects foreign Host headers on GET (DNS rebinding)', async () => {
    const { spawn } = await import('node:child_process');
    const http = await import('node:http');
    const port = '7795';
    const server = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...env, OFFICE_DRY: '1', OFFICE_PORT: port } });
    await new Promise(r => server.stdout.once('data', r));
    const status = host =>
        new Promise((resolve, reject) =>
            http.get({ host: '127.0.0.1', port, path: '/api/sessions', headers: { host } }, res => (res.resume(), resolve(res.statusCode))).on('error', reject),
        );
    try {
        assert.equal(await status(`127.0.0.1:${port}`), 200);
        assert.equal(await status(`localhost:${port}`), 200);
        assert.equal(await status('evil.example'), 403);
        assert.equal(await status(`evil.example:${port}`), 403);
    } finally {
        server.kill();
    }
});

test('a summary is hidden once the session has a newer event', () => {
    const dir = path.join(HOME, '.claude/office/summaries');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'local_4.md');
    fs.writeFileSync(file, '## 결재 보고\n### 한 줄 요약\n1. 예전 요약');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(file, old, old);
    assert.equal(listSessions().find(s => s.id === 'local_4').summary, null);
    const future = new Date(Date.now() + 60 * 1000);
    fs.utimesSync(file, future, future);
    assert.match(listSessions().find(s => s.id === 'local_4').summary, /예전 요약/);
});
