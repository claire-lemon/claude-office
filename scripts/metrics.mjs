#!/usr/bin/env node
// Scripted metrics (spec 9.2 #3, #4, #6, #7). UI metrics (#1, #5, #8) are checked in the browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-metrics-'));
const env = { ...process.env, OFFICE_HOME: home, OFFICE_PORT: '7799' };
const p95 = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
const timed = fn => {
    const t = performance.now();
    fn();
    return performance.now() - t;
};

execFileSync('node', [path.join(ROOT, 'scripts/simulate.mjs'), '--once'], { env });

const hookMs = Array.from({ length: 100 }, (_, i) =>
    timed(() =>
        spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], {
            env,
            input: JSON.stringify({ session_id: `m${i % 10}`, hook_event_name: 'UserPromptSubmit' }),
        }),
    ),
);

const bareMs = Array.from({ length: 100 }, () => timed(() => spawnSync('node', ['-e', ''])));
const hookOverhead = p95(hookMs) - p95(bareMs);

const server = spawn('node', [path.join(ROOT, 'server.mjs')], { env });
await new Promise(r => server.stdout.once('data', r));
const apiMs = [];
for (const _ of Array.from({ length: 50 })) {
    const t = performance.now();
    await fetch('http://127.0.0.1:7799/api/sessions').then(r => r.json());
    apiMs.push(performance.now() - t);
}
server.kill();

const noApp = spawnSync('node', ['-e', "import('./lib.mjs').then(l => l.buildSessions())"], {
    cwd: ROOT,
    env: { ...env, OFFICE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'office-empty-')), OFFICE_APP_DIR: '/nonexistent' },
});
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;

const rows = [
    ['#3 hook overhead p95 vs bare node', `${hookOverhead.toFixed(1)}ms (total ${p95(hookMs).toFixed(0)}ms)`, hookOverhead <= 10 ? 'PASS' : 'FAIL'],
    ['#4 /api/sessions p95 (20 sessions on disk)', `${p95(apiMs).toFixed(1)}ms`, p95(apiMs) <= 200 ? 'PASS' : 'FAIL'],
    ['#6 boots without app dir', noApp.status === 0 ? 'ok' : 'crash', noApp.status === 0 ? 'PASS' : 'FAIL'],
    ['#7 dependencies', String(deps), deps === 0 ? 'PASS' : 'FAIL'],
];
console.table(rows.map(([metric, value, result]) => ({ metric, value, result })));
process.exit(rows.every(r => r[2] === 'PASS') ? 0 : 1);
