import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_DESKS } from '../../src/config.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('held sessions keep a desk even when MAX_DESKS fresher sessions exist', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-hold-'));
    const stateDir = path.join(home, '.claude/office/state');
    fs.mkdirSync(stateDir, { recursive: true });
    const now = Date.now();
    const put = (id, at) => fs.writeFileSync(path.join(stateDir, `${id}.json`), JSON.stringify({ event: 'Stop', at }));
    put('old-held', now - 40 * 3600 * 1000);
    Array.from({ length: MAX_DESKS }, (_, i) => put(`fresh-${i}`, now - i * 1000));
    fs.writeFileSync(path.join(home, '.claude/office/decisions.json'), JSON.stringify({ 'old-held': { kind: 'hold', at: now - 39 * 3600 * 1000 } }));
    const out = execFileSync(
        'node',
        ['-e', "import('./src/usecases/list-sessions.mjs').then(l => console.log(JSON.stringify(l.listSessions().map(s => [s.id, s.status]))))"],
        { cwd: ROOT, env: { ...process.env, OFFICE_HOME: home, OFFICE_APP_DIR: path.join(home, 'none') } },
    );
    const rows = JSON.parse(out.toString());
    assert.equal(rows.length, MAX_DESKS);
    assert.deepEqual(rows.find(r => r[0] === 'old-held'), ['old-held', 'hold']);
});
