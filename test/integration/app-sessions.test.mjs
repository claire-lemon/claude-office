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
