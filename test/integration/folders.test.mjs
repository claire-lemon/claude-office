import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 최근 프로젝트 폴더 cleanup against its own fixture home, in process (no server). config.mjs reads env at
// import time.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-folders-'));
process.env.OFFICE_HOME = HOME;
const { OFFICE_DIR, APP_SCRATCH_DIR, TODOS_FILE } = await import('../../src/config.mjs');
const { meetingPrompt } = await import('../../src/domain/meeting.mjs');
const { localDate } = await import('../../src/domain/daily-note.mjs');
const { folders, listTodos } = await import('../../src/usecases/todos.mjs');
const { syncMeetingBoard } = await import('../../src/usecases/meeting.mjs');

const TODAY = localDate(Date.now());
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const repo = name => path.join(HOME, 'code', name);
const scratch = path.join(APP_SCRATCH_DIR, 'a', 'b', 'scratch-1');
const worktree = path.join(repo('api'), '.claude', 'worktrees', 'fix-1a2b3c');
const homeWorktree = path.join(HOME, '.claude', 'worktrees', 'odd-9f8e7d');
[APP, STATE, repo('api'), repo('web'), repo('picked'), repo('told'), scratch, worktree, homeWorktree, path.join(HOME, 't')].forEach(d =>
    fs.mkdirSync(d, { recursive: true }));

const T0 = Date.now() - 10 * 60_000;
const app = (id, fields, at) =>
    fs.writeFileSync(path.join(APP, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: `cli-${id}`, title: id, isArchived: false, prs: [], lastActivityAt: at, ...fields }));
app('home', { cwd: HOME, originCwd: HOME }, T0 + 9);
app('office', { cwd: OFFICE_DIR, originCwd: OFFICE_DIR }, T0 + 8);
app('scratch', { cwd: scratch, originCwd: scratch }, T0 + 7);
app('wt', { cwd: worktree }, T0 + 6); // no originCwd: the worktree path alone
app('homewt', { cwd: homeWorktree }, T0 + 5);
app('web', { cwd: repo('web'), originCwd: repo('web') }, T0 + 4);
app('gone', { cwd: repo('gone'), originCwd: repo('gone') }, T0 + 3);
fs.mkdirSync(path.dirname(TODOS_FILE), { recursive: true });
fs.writeFileSync(TODOS_FILE, JSON.stringify({
    pick01: { title: '고른 폴더의 일', detail: '', folder: repo('picked'), createdAt: T0 + 1, source: 'manual', manual: null, deletedAt: null },
    home01: { title: '홈에 잘못 둔 일', detail: '', folder: HOME, createdAt: T0 + 2, source: 'scrum', manual: null, deletedAt: null },
}));

test('folders: no home, office dir or scratch; a worktree reads as its repo; 칠판 folders join; gone ones drop', () => {
    assert.deepEqual(folders().map(f => [f.name, f.path]), [
        ['api', repo('api')],
        ['web', repo('web')],
        ['picked', repo('picked')],
    ]);
});

test('meeting sync: an absolute path the user told the facilitator is taken when it is a real project folder', () => {
    const cli = 'cli-m1';
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    const line = (type, content) => `${JSON.stringify({ type, message: { role: type, content: type === 'user' ? content : [{ type: 'text', text: content }] } })}\n`;
    const reply = ['### 칠판', `1. 알려준 폴더의 일 하기 — ${repo('told')}`, `2. 홈에 두면 안 되는 일 하기 — ${HOME}`, '3. 목록에 있는 폴더의 일 하기 — web'].join('\n');
    fs.writeFileSync(file, line('user', meetingPrompt(`${TODAY}-1`, 'note.md', 'CLAUDE.md')) + line('assistant', reply));
    app('m1', { cwd: OFFICE_DIR, originCwd: OFFICE_DIR, createdAt: Date.now() - 60_000 }, Date.now());
    fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event: 'Stop', at: Date.now(), cwd: OFFICE_DIR, transcriptPath: file }));

    const r = syncMeetingBoard();
    assert.equal(r.created, 2);
    assert.deepEqual(r.skipped.map(s => [s.title, s.reason]), [['홈에 두면 안 되는 일 하기', 'unknown folder']]);
    const made = listTodos().todos.filter(t => t.source === 'scrum' && t.meeting).map(t => [t.title, t.folder]);
    assert.deepEqual(made, [['알려준 폴더의 일 하기', repo('told')], ['목록에 있는 폴더의 일 하기', repo('web')]]);
});
