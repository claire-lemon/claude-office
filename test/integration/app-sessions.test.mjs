import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
