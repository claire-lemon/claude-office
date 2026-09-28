import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
process.env.OFFICE_HOME = HOME;
const lib = await import('../lib.mjs');
const env = { ...process.env, OFFICE_HOME: HOME };
const hook = input =>
    spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], { env, input: typeof input === 'string' ? input : JSON.stringify(input) });
const TITLE_1 = '인프라 구조 정리';
const stateOf = id => JSON.parse(fs.readFileSync(path.join(HOME, '.claude/office/state', `${id}.json`), 'utf8'));

test('parseReport: block, missing block, missing sections', () => {
    const r = lib.parseReport('앞말\n## 결재 보고\n### 한 줄 요약\n요약\n### 리뷰 필요\n- a.ts:1 — 이유\n## 다른 섹션\nx');
    assert.deepEqual(r, { '한 줄 요약': '요약', '리뷰 필요': '- a.ts:1 — 이유' });
    assert.equal(lib.parseReport('그냥 답변'), null);
    assert.deepEqual(lib.parseReport('## 결재 보고\n'), {});
});

test('deriveStatus: every row of the mapping, decisions win until a newer event', () => {
    const s = (event, at = 10) => ({ event, at });
    const d = (kind, at = 11) => ({ kind, at });
    assert.equal(lib.deriveStatus({ state: null }), 'unknown');
    assert.equal(lib.deriveStatus({ state: s('UserPromptSubmit') }), 'working');
    assert.equal(lib.deriveStatus({ state: s('Notification') }), 'blocked');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: true }), 'review');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: false }), 'question');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: true, decision: d('confirm') }), 'done');
    assert.equal(lib.deriveStatus({ state: s('Stop'), decision: d('hold') }), 'hold');
    assert.equal(lib.deriveStatus({ state: s('Stop'), decision: d('archive') }), 'archived');
    assert.equal(lib.deriveStatus({ state: null, decision: d('hold') }), 'hold');
    assert.equal(lib.deriveStatus({ state: s('UserPromptSubmit', 12), decision: d('hold') }), 'working');
});

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
    const sessions = lib.buildSessions();
    assert.equal(sessions.length, 10);
    const byId = Object.fromEntries(sessions.map(s => [s.id, s]));
    assert.equal(byId.local_0.status, 'working');
    assert.equal(byId.local_1.status, 'review');
    assert.equal(byId.local_1.report['한 줄 요약'].includes('workspace$'), true);
    assert.equal(byId.local_2.status, 'blocked');
    assert.equal(byId.local_3.status, 'question');
    assert.equal(byId.local_0.link, 'claude://claude.ai/epitaxy/local_0');
    const d = lib.diffFor(byId.local_0);
    assert.equal(d.tracked, true);
    assert.deepEqual(d.files.map(f => f.path), ['views.ts']);
    assert.deepEqual(d.untracked, ['new-file.md']);
    assert.equal(lib.diffFor(byId.local_1).tracked, false);
    assert.deepEqual(lib.gitInfo(path.join(HOME, 'repo')), { project: 'repo', branch: 'feat/x' });
    assert.equal(byId.local_0.cwd.endsWith('/repo'), true);
    assert.equal(byId.local_0.diffStat, null);
    hook({ session_id: 'cli-0', hook_event_name: 'Stop' });
    const stopped = lib.buildSessions().find(s => s.id === 'local_0');
    assert.deepEqual(stopped.diffStat, { files: 1, add: 1, del: 0 });
});

test('buildSessions survives a missing app dir (hook-only sessions)', () => {
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'office-noapp-'));
    const out = execFileSync(
        'node',
        ['-e', "import('./lib.mjs').then(l => console.log(JSON.stringify(l.buildSessions().map(s => [s.title, s.status]))))"],
        { cwd: ROOT, env: { ...env, OFFICE_HOME: home2, OFFICE_APP_DIR: path.join(home2, 'nope') } },
    );
    assert.equal(out.toString().trim(), '[]');
});

test('install is idempotent, keeps foreign hooks, uninstall removes only ours', () => {
    const settings = path.join(HOME, '.claude/settings.json');
    const foreign = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, model: 'x' };
    fs.writeFileSync(settings, JSON.stringify(foreign));
    const run = (...a) => execFileSync('node', [path.join(ROOT, 'install.mjs'), ...a], { env });
    run();
    run();
    const installed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.equal(installed.hooks.Stop.length, 2);
    assert.equal(installed.hooks.UserPromptSubmit.length, 1);
    run('--uninstall');
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), foreign);
});

test('parseTasks + nextTaskPrompt + newSessionLink', () => {
    const tasks = lib.parseTasks('1. 타입 배포\n   1. 선배포 필요\n2. 프론트 표시\n3. 캐시 적용');
    assert.deepEqual(tasks, [
        { title: '타입 배포', detail: '선배포 필요' },
        { title: '프론트 표시', detail: '' },
        { title: '캐시 적용', detail: '' },
    ]);
    assert.deepEqual(lib.parseTasks(undefined), []);
    const prompt = lib.nextTaskPrompt(
        { title: '뷰 확장', branch: 'feat/x', prs: [{ url: 'https://github.com/a/b/pull/1' }], report: { '한 줄 요약': '1. 추가 완료' } },
        tasks[0],
    );
    assert.match(prompt, /이전 세션 "뷰 확장"/);
    assert.match(prompt, /PR: https:\/\/github.com\/a\/b\/pull\/1/);
    assert.match(prompt, /할 일: 타입 배포\n선배포 필요$/);
    assert.equal(lib.nextTaskPrompt({ title: 't' }, { title: 'x'.repeat(5000), detail: '' }).length, 2000);
    const link = lib.newSessionLink('/a b/repo', '할 일 & ok');
    assert.equal(link, 'claude://code/new?q=%ED%95%A0%20%EC%9D%BC%20%26%20ok&folder=%2Fa%20b%2Frepo');
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
