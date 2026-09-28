import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// bin/office.mjs against its own fixture home: same usecases and files as the server, no server running.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-cli-'));
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const OFFICE_DIR = path.join(HOME, '.claude/office');
const repo = path.join(HOME, 'repos', 'api');
[APP, repo, OFFICE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
const app = (id, folder, lastActivityAt) =>
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: `cli-${id}`, title: id, cwd: folder, originCwd: folder, lastActivityAt, isArchived: false, prs: [] }));
app('local_a', repo, Date.now() - 60_000);
app('local_m', OFFICE_DIR, Date.now()); // a facilitator session: its folder is not a project

const cli = (...args) => {
    const r = spawnSync('node', [path.join(ROOT, 'bin/office.mjs'), ...args], { env: { ...process.env, OFFICE_HOME: HOME }, encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout) };
};
const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${JSON.stringify(r.out)}`);
    return r.out;
};
const fails = (args, error) => {
    const r = cli(...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.deepEqual(Object.keys(r.out), ['error'], args.join(' '));
    if (typeof error === 'string') assert.equal(r.out.error, error, args.join(' '));
    else assert.match(r.out.error, error, args.join(' '));
};

test('todo add (scrum and manual) -> list -> update -> delete, in the OFFICE_HOME files', () => {
    const { todo: scrum } = ok('todo', 'add', '결제 모듈', '--folder', `${repo}/`, '--detail', 'PG 파싱 이동', '--source', 'scrum');
    assert.deepEqual([scrum.title, scrum.detail, scrum.folder, scrum.project, scrum.source, scrum.status], ['결제 모듈', 'PG 파싱 이동', repo, 'api', 'scrum', 'open']);
    const { todo: manual } = ok('todo', 'add', '회의록', '--folder', repo);
    assert.deepEqual([manual.source, manual.detail], ['manual', '']);
    const stored = JSON.parse(fs.readFileSync(path.join(OFFICE_DIR, 'todos.json'), 'utf8'));
    assert.deepEqual(Object.keys(stored).sort(), [scrum.id, manual.id].sort());

    const listed = ok('todo', 'list');
    assert.deepEqual(Object.keys(listed), ['todos', 'deleted', 'folders']);
    assert.deepEqual(listed.todos.map(t => t.id), [scrum.id, manual.id]);

    const renamed = ok('todo', 'update', scrum.id, '--title', '결제 모듈 v2', '--done', 'true').todo;
    assert.deepEqual([renamed.title, renamed.status, renamed.by], ['결제 모듈 v2', 'done', 'manual']);
    assert.equal(ok('todo', 'update', scrum.id, '--done', 'false').todo.status, 'open');
    fails(['todo', 'update', scrum.id, '--done', 'yes'], 'done must be a boolean');
    fails(['todo', 'update', scrum.id], 'empty patch');
    fails(['todo', 'update', 'zzzzzz', '--title', 'x'], 'unknown todo');

    assert.deepEqual(ok('todo', 'delete', manual.id), { ok: true });
    const after = ok('todo', 'list');
    assert.deepEqual(after.todos.map(t => t.id), [scrum.id]);
    assert.deepEqual(after.deleted, [{ id: manual.id, title: '회의록' }]);
    fails(['todo', 'delete', 'zzzzzz'], 'unknown todo');
});

test('folders: recent app-session project folders, the facilitator folder left out', () => {
    const { folders } = ok('folders');
    assert.deepEqual(folders.map(f => [f.path, f.name]), [[repo, 'api']]);
    assert.deepEqual(ok('todo', 'list').folders, folders);
});

test('bad input: exit 1 with { error }; usage errors list every command', () => {
    fails(['todo', 'add', 'x', '--folder', path.join(HOME, 'nope')], 'folder not found');
    fails(['todo', 'add', 'x'], 'folder required');
    fails(['todo', 'add', 'x', '--folder', 'repos/api'], 'folder must be an absolute path');
    const usage = /todo list[\s\S]*todo add[\s\S]*todo update[\s\S]*todo delete[\s\S]*folders/;
    [[], ['todo'], ['todo', 'nope'], ['nope'], ['todo', 'add'], ['todo', 'delete'], ['todo', 'list', 'extra'], ['todo', 'list', '--title', 'x'], ['todo', 'add', 'x', '--done', 'true'], ['--bogus'], ['todo', 'add', 'x', '--folder']].forEach(args =>
        fails(args, usage));
    // nothing above wrote a todo
    assert.equal(ok('todo', 'list').todos.length, 1);
});
