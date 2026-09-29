import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('buildSessions survives a missing app dir (hook-only sessions)', () => {
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'office-noapp-'));
    const out = execFileSync(
        'node',
        ['-e', "import('./src/usecases/list-sessions.mjs').then(l => console.log(JSON.stringify(l.listSessions().map(s => [s.title, s.status]))))"],
        { cwd: ROOT, env: { ...process.env, OFFICE_HOME: home2, OFFICE_APP_DIR: path.join(home2, 'nope') } },
    );
    assert.equal(out.toString().trim(), '[]');
});

test('hooksInstalled: false with app sessions but no hook state, true once the hook has written one', () => {
    const home3 = fs.mkdtempSync(path.join(os.tmpdir(), 'office-nohook-'));
    const app = path.join(home3, 'Library/Application Support/Claude/claude-code-sessions/u/u');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'local_a.json'), JSON.stringify({ sessionId: 'local_a', cliSessionId: 'cli-a', title: 't', cwd: home3, lastActivityAt: Date.now() }));
    const env = { ...process.env, OFFICE_HOME: home3 };
    const probe = () => execFileSync('node', ['-e', "import('./src/usecases/list-sessions.mjs').then(l => console.log(JSON.stringify([l.hooksInstalled(), l.listSessions().map(s => s.status)])))"], { cwd: ROOT, env }).toString().trim();
    assert.equal(probe(), '[false,["unknown"]]');
    execFileSync('node', [path.join(ROOT, 'hooks/report.mjs')], { env, input: JSON.stringify({ session_id: 'cli-a', hook_event_name: 'UserPromptSubmit', cwd: home3 }) });
    assert.equal(probe(), '[true,["working"]]');
});

test('event history: hook appends what it records to state, list-sessions derives pendingSince and turnMs', () => {
    const home4 = fs.mkdtempSync(path.join(os.tmpdir(), 'office-events-'));
    const env = { ...process.env, OFFICE_HOME: home4 };
    const hook = event => {
        const r = spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], { env, input: JSON.stringify({ session_id: 'cli-e', hook_event_name: event, cwd: home4 }) });
        assert.equal(r.status, 0);
        assert.equal(r.stdout.length, 0);
    };
    ['UserPromptSubmit', 'Stop', 'Notification', 'UserPromptSubmit', 'Notification', 'Stop', 'Stop'].forEach(hook);
    const file = path.join(home4, '.claude/office/events/cli-e.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    // the idle Notification right after the first Stop is dropped, exactly like the state file
    assert.deepEqual(lines.map(l => l.event), ['UserPromptSubmit', 'Stop', 'UserPromptSubmit', 'Notification', 'Stop', 'Stop']);
    const state = JSON.parse(fs.readFileSync(path.join(home4, '.claude/office/state/cli-e.json'), 'utf8'));
    assert.equal(state.at, lines[5].at);
    fs.appendFileSync(file, '{broken\n'); // a torn line is skipped, not fatal
    const out = execFileSync('node', ['-e', "import('./src/usecases/list-sessions.mjs').then(l => console.log(JSON.stringify(l.listSessions().map(s => [s.status, s.pendingSince, s.turnMs]))))"], { cwd: ROOT, env });
    const [[status, since, turnMs]] = JSON.parse(out.toString());
    assert.equal(status, 'question');
    assert.equal(since, lines[4].at); // two Stops in a row: waiting since the first
    assert.equal(turnMs, lines[5].at - lines[2].at); // the second Stop continues the same turn
});
