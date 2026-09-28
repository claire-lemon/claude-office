import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Own fixture home, separate from the other integration tests (config.mjs reads env at import
// time, so this must be set before the first dynamic import below).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-changes-test-'));
process.env.OFFICE_HOME = HOME;
const { getChanges } = await import('../../src/usecases/get-changes.mjs');
const { listSessions } = await import('../../src/usecases/list-sessions.mjs');
const { DIFF_FILE_LIMIT } = await import('../../src/config.mjs');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
const commitAll = (dir, msg) => {
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg]);
};
const initRepo = (dir, branch = 'main') => {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', branch]);
};
const tmpRepo = branch => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-changes-repo-'));
    initRepo(dir, branch);
    return dir;
};

test('new untracked file: shown as an added file with full content, not just a name', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'committed.txt'), 'a\n');
    commitAll(dir, 'init');
    fs.writeFileSync(path.join(dir, 'new.md'), 'hello\nworld\n');

    const d = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'main' });
    assert.equal(d.tracked, true);
    assert.deepEqual(d.untracked, ['new.md']);
    const f = d.files.find(f => f.path === 'new.md');
    assert.equal(f.status, 'added');
    assert.equal(f.untracked, true);
    assert.equal(f.add, 2);
    assert.match(f.patch, /\+hello/);
    assert.match(f.patch, /\+world/);
    assert.equal(d.totals.added, 1);
    assert.equal(d.totals.files, 1);
});

test('untracked files respect .gitignore', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
    commitAll(dir, 'init');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'secret\n');
    fs.writeFileSync(path.join(dir, 'visible.txt'), 'shown\n');

    const d = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'main' });
    assert.deepEqual(d.untracked, ['visible.txt']);
    assert.deepEqual(d.files.map(f => f.path), ['visible.txt']);
});

test('worktree-less session (worktreePath null) falls back to repoRoot(cwd), incl. tilde-abbreviated cwd', () => {
    const dir = path.join(HOME, 'proj');
    initRepo(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'init');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'new.md'), 'hi\n');

    // session.cwd as domain/session-view.mjs's tilde() would produce it for a path under HOME,
    // and pointed at a subfolder (not the repo root) to prove repoRoot() climbs up.
    const d = getChanges({ worktreePath: null, cwd: '~/proj/sub', sourceBranch: 'main' });
    assert.equal(d.tracked, true);
    assert.deepEqual(d.untracked, ['new.md']);
});

test('folder resolution: no worktree and no usable cwd -> no-folder; cwd not a git repo -> not-git', () => {
    assert.deepEqual(getChanges({ worktreePath: null, cwd: null }), { tracked: false, reason: 'no-folder' });
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'office-changes-plain-'));
    assert.deepEqual(getChanges({ worktreePath: null, cwd: plain }), { tracked: false, reason: 'not-git' });
});

test('base fallback order: missing sourceBranch -> defaultBranch; on the default branch -> HEAD (uncommitted only)', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'c1');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n');
    commitAll(dir, 'c2');
    git(dir, ['checkout', '-qb', 'feat/x']);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n3\n');
    commitAll(dir, 'c3');

    // sourceBranch points at a branch that no longer exists -> falls back to defaultBranch (main).
    const onFeature = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'feat/gone' });
    assert.deepEqual(onFeature.base, { ref: 'main', source: 'default' });
    const a = onFeature.files.find(f => f.path === 'a.txt');
    assert.deepEqual([a.status, a.add, a.del], ['modified', 1, 0]);

    // Back on the default branch itself: no sourceBranch, comparing to itself would be a no-op,
    // so the base becomes HEAD -- only the uncommitted edit shows up.
    git(dir, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\nX\n');
    const onDefault = getChanges({ worktreePath: dir, cwd: dir });
    assert.deepEqual(onDefault.base, { ref: 'main', source: 'head' });
    const a2 = onDefault.files.find(f => f.path === 'a.txt');
    assert.deepEqual([a2.status, a2.add, a2.del], ['modified', 1, 0]);
});

test('per-file size limit: an oversized untracked file is flagged tooLarge with no patch', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'init');
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(DIFF_FILE_LIMIT + 1024));

    const d = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'main' });
    const f = d.files.find(f => f.path === 'big.txt');
    assert.equal(f.tooLarge, true);
    assert.equal(f.patch, '');
});

test('binary untracked file: binary:true, no patch content', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'init');
    fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 0, 3, 0, 4, 5]));

    const d = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'main' });
    const f = d.files.find(f => f.path === 'img.bin');
    assert.equal(f.status, 'added');
    assert.equal(f.binary, true);
    assert.equal(f.patch, '');
});

test('empty: on the default branch with nothing changed, reports why', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'init');

    const d = getChanges({ worktreePath: dir, cwd: dir });
    assert.deepEqual(d.files, []);
    assert.deepEqual(d.base, { ref: 'main', source: 'head' });
    assert.deepEqual(d.empty, { committed: false, uncommitted: false });
});

test('diffStat on a list-sessions card includes new (untracked) files, not just tracked ones', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
    commitAll(dir, 'init');
    fs.writeFileSync(path.join(dir, 'report.md'), 'line one\nline two\n');

    const appDir = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions', 'u', 'u');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
        path.join(appDir, 'local_changes.json'),
        JSON.stringify({
            sessionId: 'local_changes', cliSessionId: 'cli-changes', title: 't', cwd: dir,
            worktreePath: dir, sourceBranch: 'main', branch: 'main', prs: [], completedTurns: 1,
            lastActivityAt: Date.now(), isArchived: false,
        }),
    );
    const hook = spawnSync('node', [path.join(ROOT, 'hooks/report.mjs')], {
        env: { ...process.env, OFFICE_HOME: HOME },
        input: JSON.stringify({ session_id: 'cli-changes', hook_event_name: 'Stop', cwd: dir }),
    });
    assert.equal(hook.status, 0);

    const session = listSessions().find(s => s.id === 'local_changes');
    assert.equal(session.status, 'question');
    assert.deepEqual(session.diffStat, { files: 1, add: 2, del: 0 });
});

test('a new file already committed on the branch still counts as a new file', () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'base.txt'), 'a\n');
    commitAll(dir, 'init');
    git(dir, ['checkout', '-qb', 'feat/doc']);
    fs.writeFileSync(path.join(dir, 'report.md'), '# 보고\n1. 완료\n');
    commitAll(dir, 'add report');

    const d = getChanges({ worktreePath: dir, cwd: dir, sourceBranch: 'main' });
    const f = d.files.find(x => x.path === 'report.md');
    assert.equal(f.status, 'added');
    assert.equal(f.untracked, false);
    assert.equal(f.add, 2);
    assert.equal(d.totals.added, 1);
});
