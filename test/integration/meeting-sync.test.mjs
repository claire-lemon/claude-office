import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 회의실 → 칠판 sync (meeting-board-sync design §4.2) against its own fixture home: the usecases in process
// (no timer racing the steps), then one server on its own port to see the timer do it (todos 7792, meeting
// 7791, finishing 7793, office 7794-7798, metrics 7799). config.mjs reads env at import time.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-meeting-sync-'));
process.env.OFFICE_HOME = HOME;
const { OFFICE_DIR, TODOS_FILE, DECISIONS_FILE, MEETING_SYNC_EVERY } = await import('../../src/config.mjs');
const { meetingPrompt } = await import('../../src/domain/meeting.mjs');
const { localDate } = await import('../../src/domain/daily-note.mjs');
const { syncMeetingBoard, getMeeting, endMeeting } = await import('../../src/usecases/meeting.mjs');
const { listTodos, createTodo, updateTodo, deleteTodo } = await import('../../src/usecases/todos.mjs');

const TODAY = localDate(Date.now());
const MID = `${TODAY}-1`;
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const NOTE = path.join(OFFICE_DIR, 'daily', `${TODAY}.md`);
const api = path.join(HOME, 'repos', 'api-server');
const docs = path.join(HOME, 'repos', 'knowledge');
[APP, STATE, api, docs, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const app = (id, cli, folder, title, extra = {}) =>
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: cli, title, cwd: folder, originCwd: folder, lastActivityAt: Date.now(), isArchived: false, prs: [], ...extra }));
const state = (cli, cwd, transcriptPath) => fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event: 'Stop', at: Date.now(), cwd, transcriptPath }));
const userLine = content => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
const assistantLine = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const board = (...lines) => `### 어제 끝낸 일\n1. 결제 분리 완료\n\n### 칠판\n${lines.join('\n')}`;

// Two project folders the 칠판 knows by name (work sessions in them); local_a can be assigned.
const tA = path.join(HOME, 't', 'cli-a.jsonl');
fs.writeFileSync(tA, userLine('결제 작업') + assistantLine('결제 분리 완료'));
app('local_a', 'cli-a', api, 'A 세션');
state('cli-a', api, tA);
app('local_k', 'cli-k', docs, 'K 세션');

// A facilitator the way the app creates one; say() = the user's next line and the facilitator's reply.
const facilitator = (n, reply) => {
    const cli = `cli-m${n}`;
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, userLine(meetingPrompt(`${TODAY}-${n}`, NOTE, path.join(OFFICE_DIR, 'CLAUDE.md'))) + assistantLine(reply));
    app(`local_m${n}`, cli, OFFICE_DIR, '데일리 스크럼 진행자', { createdAt: Date.now() - 60_000 });
    state(cli, OFFICE_DIR, file);
    const say = (user, next) => {
        fs.appendFileSync(file, userLine(user) + assistantLine(next));
        state(cli, OFFICE_DIR, file);
    };
    return { say };
};

const stored = () => JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8'));
const byTitle = title => listTodos().todos.find(t => t.title === title);
const counts = r => [r.meetingId, r.created, r.updated, r.removed];
const m1 = facilitator(1, board('1. 결제 모듈 리팩터링 — api-server', '   1. PG 응답 파싱을 use-case로 옮기기', '2. 문서 정리 — knowledge', '3. 모르는 일 — nowhere'));

test('the first reply fills the 칠판; the unknown folder is reported, not written', () => {
    const r = syncMeetingBoard();
    assert.deepEqual(counts(r), [MID, 2, 0, 0]);
    assert.deepEqual(r.skipped, [{ title: '모르는 일', folder: 'nowhere', reason: 'unknown folder' }]);
    assert.deepEqual(listTodos().todos.map(t => [t.title, t.folder, t.detail, t.source, t.meeting]), [
        ['결제 모듈 리팩터링', api, 'PG 응답 파싱을 use-case로 옮기기', 'scrum', { id: MID, key: '결제 모듈 리팩터링' }],
        ['문서 정리', docs, '', 'scrum', { id: MID, key: '문서 정리' }],
    ]);
    assert.deepEqual(getMeeting().board, { meetingId: MID, count: 2, skipped: [{ title: '모르는 일', folder: 'nowhere', reason: 'unknown folder' }] });
});

test('the same reply again -> no-op, no write (forced too: the plan is empty)', () => {
    const before = [fs.readFileSync(TODOS_FILE, 'utf8'), fs.statSync(TODOS_FILE).mtimeMs];
    assert.deepEqual(counts(syncMeetingBoard()), [MID, 0, 0, 0]);
    assert.deepEqual(counts(syncMeetingBoard(Date.now(), { force: true })), [MID, 0, 0, 0]);
    assert.deepEqual([fs.readFileSync(TODOS_FILE, 'utf8'), fs.statSync(TODOS_FILE).mtimeMs], before);
});

test('next reply: the dropped item soft-deleted, detail updated, a manual todo of the same title not duplicated', () => {
    assert.ok(createTodo({ title: '배포 준비', folder: api }).todo);
    m1.say('문서는 빼고 배포 준비랑 타입 배포 넣어줘', board(
        '1. 결제 모듈 리팩터링 — api-server', '   1. 파싱 이동 + 테스트', '2. 배포 준비 — api-server', '3. 타입 배포 — knowledge',
    ));
    const r = syncMeetingBoard();
    assert.deepEqual([...counts(r), r.skipped], [MID, 1, 1, 1, []]);
    assert.ok(Object.values(stored()).find(t => t.title === '문서 정리').deletedAt, 'soft delete: the record stays');
    assert.equal(byTitle('결제 모듈 리팩터링').detail, '파싱 이동 + 테스트');
    assert.deepEqual(listTodos().todos.filter(t => t.title === '배포 준비').map(t => t.source), ['manual']);
    assert.equal(byTitle('타입 배포').meeting.id, MID);
    assert.deepEqual(getMeeting().board, { meetingId: MID, count: 2, skipped: [] });
});

test('assigned or checked items stay when dropped; one the user deleted is not written again', () => {
    assert.ok(updateTodo(byTitle('결제 모듈 리팩터링').id, { assign: 'local_a' }).todo);
    assert.ok(updateTodo(byTitle('타입 배포').id, { done: true }).todo);
    m1.say('다 됐고 새 일 하나만', board('1. 새 일 — knowledge'));
    assert.deepEqual(counts(syncMeetingBoard()), [MID, 1, 0, 0]);
    assert.deepEqual(listTodos().todos.map(t => [t.title, t.status]), [
        ['결제 모듈 리팩터링', 'started'], ['배포 준비', 'open'], ['타입 배포', 'done'], ['새 일', 'open'],
    ]);
    // deleted on the 칠판 while the facilitator keeps listing it: stays deleted
    assert.ok(deleteTodo(byTitle('새 일').id).ok);
    assert.deepEqual(counts(syncMeetingBoard(Date.now(), { force: true })), [MID, 0, 0, 0]);
    assert.equal(byTitle('새 일'), undefined);
});

test('end: the latest reply is synced before archiving and `## 회의 1` lists the synced todos', () => {
    m1.say('마지막으로 하나 더', board('1. 새 일 — knowledge', '2. 마지막 일 — api-server'));
    assert.deepEqual(endMeeting(), { note: NOTE, n: 1 });
    assert.equal(JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8')).local_m1.kind, 'archive');
    const note = fs.readFileSync(NOTE, 'utf8');
    const section = note.slice(note.indexOf('## 회의 1'));
    assert.ok(section.includes('1. 오늘 할 일 확정 4개\n'), section);
    assert.ok(section.includes('   4. ☐ 마지막 일 — api-server\n'), section);
    // archived: the timer leaves it alone; the 회의실 still counts what it wrote
    assert.deepEqual(counts(syncMeetingBoard()), [null, 0, 0, 0]);
    assert.deepEqual(getMeeting().board, { meetingId: MID, count: 3, skipped: [] });
});

const PORT = '7790';
const origin = `http://127.0.0.1:${PORT}`;
const server = { proc: null };
after(() => server.proc?.kill());

test('server timer: a new meeting\'s list reaches the 칠판 and /api/meeting within a few ticks', async () => {
    facilitator(2, board('1. 두 번째 회의 일 — knowledge', '2. 또 모르는 일 — nowhere'));
    server.proc = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...process.env, OFFICE_HOME: HOME, OFFICE_DRY: '1', OFFICE_PORT: PORT } });
    await once(server.proc.stdout, 'data');
    const until = Date.now() + 4 * MEETING_SYNC_EVERY;
    const poll = async () => {
        const meeting = await fetch(`${origin}/api/meeting`).then(r => r.json());
        if (meeting.board.count || Date.now() > until) return meeting;
        await new Promise(r => setTimeout(r, 200));
        return poll();
    };
    const meeting = await poll();
    assert.deepEqual(meeting.board, { meetingId: `${TODAY}-2`, count: 1, skipped: [{ title: '또 모르는 일', folder: 'nowhere', reason: 'unknown folder' }] });
    const { todos } = await fetch(`${origin}/api/todos`).then(r => r.json());
    assert.deepEqual(todos.filter(t => t.meeting?.id === `${TODAY}-2`).map(t => [t.title, t.source]), [['두 번째 회의 일', 'scrum']]);
});
