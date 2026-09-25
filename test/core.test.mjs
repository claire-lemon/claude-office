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
const stateOf = id => JSON.parse(fs.readFileSync(path.join(HOME, '.claude/office/state', `${id}.json`), 'utf8'));

test('parseReport: block, missing block, missing sections', () => {
    const r = lib.parseReport('앞말\n## 결재 보고\n### 한 줄 요약\n요약\n### 리뷰 필요\n- a.ts:1 — 이유\n## 다른 섹션\nx');
    assert.deepEqual(r, { '한 줄 요약': '요약', '리뷰 필요': '- a.ts:1 — 이유' });
    assert.equal(lib.parseReport('그냥 답변'), null);
    assert.deepEqual(lib.parseReport('## 결재 보고\n'), {});
});

test('deriveStatus: every row of the mapping', () => {
    const s = (event, at = 10) => ({ event, at });
    assert.equal(lib.deriveStatus({ state: null }), 'unknown');
    assert.equal(lib.deriveStatus({ state: s('UserPromptSubmit') }), 'working');
    assert.equal(lib.deriveStatus({ state: s('Notification') }), 'blocked');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: true }), 'review');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: false }), 'question');
    assert.equal(lib.deriveStatus({ state: s('Stop'), hasReport: true, confirmedAt: 11 }), 'done');
    assert.equal(lib.deriveStatus({ state: s('UserPromptSubmit', 12), confirmedAt: 11 }), 'working');
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
