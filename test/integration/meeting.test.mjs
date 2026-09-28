import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Own fixture home and port (todos 7792, office 7794-7798, metrics 7799). config.mjs reads env at import
// time, so this is set before the dynamic imports below.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-meeting-'));
process.env.OFFICE_HOME = HOME;
const { CLI_PATH, OFFICE_DIR } = await import('../../src/config.mjs');
const { meetingPrompt, facilitatorGuide, GUIDE_HEADER } = await import('../../src/domain/meeting.mjs');
const { localDate, hhmm, noteSkeleton, AUTO_START, AUTO_END } = await import('../../src/domain/daily-note.mjs');

const NOW = Date.now();
const TODAY = localDate(NOW);
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const GUIDE = path.join(OFFICE_DIR, 'CLAUDE.md');
const NOTE = path.join(OFFICE_DIR, 'daily', `${TODAY}.md`);
const repo = path.join(HOME, 'repos', 'api');
[APP, STATE, repo, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const app = (id, cli, folder, lastActivityAt, title, extra = {}) =>
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: cli, title, cwd: folder, originCwd: folder, lastActivityAt, isArchived: false, prs: [], ...extra }));
const state = (cli, event, at, cwd, transcriptPath) => fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event, at, cwd, transcriptPath }));
const userLine = content => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
const assistantLine = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const decisions = () => JSON.parse(fs.readFileSync(path.join(OFFICE_DIR, 'decisions.json'), 'utf8'));
const note = () => fs.readFileSync(NOTE, 'utf8');

// A work session from today (with a report) and one from three days ago (outside the 어제 window).
const tW = path.join(HOME, 't', 'cli-w.jsonl');
fs.writeFileSync(tW, userLine('결제 작업') + assistantLine('## 결재 보고\n### 한 줄 요약\n1. 결제 분리 완료\n### 다음 작업\n1. 타입 배포'));
app('local_w', 'cli-w', repo, NOW - 60_000, 'W 세션');
state('cli-w', 'Stop', NOW - 30_000, repo, tW);
app('local_old', 'cli-old', repo, NOW - 3 * 24 * 3600 * 1000, '옛 세션');

// A facilitator the way the app would create one after the deep link: first prompt = meetingPrompt.
const MESSAGE = '### 어제 끝낸 일\n1. 결제 분리 완료\n\n### 오늘 추천\n1. 타입 배포';
const facilitator = (n, createdAt) => {
    const cli = `cli-m${n}`;
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, userLine(meetingPrompt(`${TODAY}-${n}`, NOTE)) + assistantLine(MESSAGE));
    app(`local_m${n}`, cli, OFFICE_DIR, Date.now(), '데일리 스크럼 진행자', { createdAt });
    state(cli, 'Stop', Date.now(), OFFICE_DIR, file);
};

const PORT = '7791';
const origin = `http://127.0.0.1:${PORT}`;
const server = { proc: null };
const start = async () => {
    server.proc = spawn('node', [path.join(ROOT, 'server.mjs')], { env: { ...process.env, OFFICE_HOME: HOME, OFFICE_DRY: '1', OFFICE_PORT: PORT } });
    await once(server.proc.stdout, 'data');
};
const stop = async () => {
    server.proc.kill();
    await once(server.proc, 'exit');
};
before(start);
after(() => server.proc?.kill());

const get = p => fetch(`${origin}${p}`).then(r => r.json());
const post = async (p, body) => {
    const res = await fetch(`${origin}${p}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const qOf = opened => new URL(opened.replace('claude://', 'http://')).searchParams;

test('server start writes the facilitator guide (version header, CLI path)', () => {
    assert.equal(fs.readFileSync(GUIDE, 'utf8'), facilitatorGuide({ cliPath: CLI_PATH }));
    assert.equal(fs.readFileSync(GUIDE, 'utf8').split('\n')[0], GUIDE_HEADER);
    assert.equal(CLI_PATH, path.join(ROOT, 'bin/office.mjs'));
});

test('before any meeting: no session, no note', async () => {
    assert.deepEqual(await get('/api/meeting'), { date: TODAY, note: { path: NOTE, exists: false }, session: null, ended: false, count: 0 });
});

test('start (dry run): note with the auto block, facilitator deep link with meeting #1', async () => {
    assert.equal((await post('/api/todos', { title: '회의 준비', folder: repo })).status, 201);
    const res = await post('/api/meeting/start');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['ok', 'opened', 'note', 'id']);
    assert.deepEqual([res.body.ok, res.body.note, res.body.id], [true, NOTE, `${TODAY}-1`]);
    const q = qOf(res.body.opened);
    assert.equal(q.get('folder'), OFFICE_DIR);
    assert.equal(q.get('q'), meetingPrompt(`${TODAY}-1`, NOTE));
    assert.ok(q.get('q').includes(`#meeting-${TODAY}-1`));

    const text = note();
    assert.ok(text.startsWith(`${noteSkeleton(TODAY)}\n${AUTO_START}\n## 어제 세션 (`), text);
    assert.ok(text.trimEnd().endsWith(AUTO_END));
    assert.match(text, /\n1\. W 세션 — 결재 대기\n {3}1\. 한 줄 요약: 결제 분리 완료\n {3}2\. 다음 작업 추천: 타입 배포\n/);
    assert.ok(!text.includes('옛 세션'));
    assert.ok(text.includes('## 칠판 (지금)\n1. ☐ 회의 준비 — api\n'));
    assert.ok(text.includes(`## 최근 프로젝트 폴더\n1. api — ${repo}\n`));
    // nothing is counted until the facilitator session itself shows up
    const meeting = await get('/api/meeting');
    assert.deepEqual([meeting.note.exists, meeting.session, meeting.count], [true, null, 0]);
});

test('a session whose first prompt carries the marker is the facilitator', async () => {
    const createdAt = Date.now() - 5 * 60_000;
    facilitator(1, createdAt);
    const meeting = await get('/api/meeting');
    assert.deepEqual([meeting.session.id, meeting.session.meetingId, meeting.session.status, meeting.ended, meeting.count], ['local_m1', `${TODAY}-1`, 'question', false, 1]);
    assert.equal(meeting.session.lastMessage, MESSAGE);
    const { sessions } = await get('/api/sessions');
    assert.ok(sessions.every(s => Object.hasOwn(s, 'meetingId')));
    assert.deepEqual(['local_m1', 'local_w'].map(id => sessions.find(s => s.id === id).meetingId), [`${TODAY}-1`, null]);
    // the facilitator's folder is not offered as a project
    assert.ok((await get('/api/todos')).folders.every(f => f.path !== OFFICE_DIR));
});

test('end: facilitator archived, `## 회의 1` appended with the 칠판 and its last message', async () => {
    const res = await post('/api/meeting/end');
    assert.deepEqual(res, { status: 200, body: { ok: true, note: NOTE, n: 1 } });
    assert.equal(decisions().local_m1.kind, 'archive');
    const meeting = await get('/api/meeting');
    assert.deepEqual([meeting.session.id, meeting.session.status, meeting.ended, meeting.count], ['local_m1', 'archived', true, 1]);
    assert.equal(meeting.session.lastMessage, MESSAGE); // off the board: lean view + last reply
    assert.equal((await get('/api/sessions')).sessions.some(s => s.id === 'local_m1'), false);

    const text = note();
    const createdAt = JSON.parse(fs.readFileSync(path.join(APP, 'local_m1.json'), 'utf8')).createdAt;
    const section = text.slice(text.indexOf('## 회의 1'));
    assert.match(section, new RegExp(`^## 회의 1 \\(${hhmm(createdAt)} ~ \\d{2}:\\d{2}\\)\\n`));
    assert.ok(section.includes('1. 오늘 할 일 확정 1개\n   1. ☐ 회의 준비 — api\n2. 진행자 마지막 메시지\n'));
    assert.ok(section.includes(MESSAGE.split('\n').map(l => `   > ${l}`.trimEnd()).join('\n')));
    assert.ok(text.indexOf(AUTO_END) < text.indexOf('## 회의 1'));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

test('start again: meeting #2, auto block regenerated, 회의 1 kept', async () => {
    assert.equal((await post('/api/todos', { title: '두 번째 할 일', folder: repo })).status, 201);
    const res = await post('/api/meeting/start');
    assert.equal(res.body.id, `${TODAY}-2`);
    assert.ok(qOf(res.body.opened).get('q').includes(`#meeting-${TODAY}-2`));
    const text = note();
    assert.ok(text.includes('2. ☐ 두 번째 할 일 — api'));
    assert.equal(text.split('## 회의 1 (').length, 2);
    assert.equal(text.split(AUTO_START).length, 2);
    assert.ok(text.indexOf(AUTO_END) < text.indexOf('## 회의 1'));
    // facilitators are meetings, not work: never listed under 어제 세션
    assert.ok(!text.includes('데일리 스크럼 진행자'));

    facilitator(2, Date.now());
    const meeting = await get('/api/meeting');
    assert.deepEqual([meeting.session.id, meeting.session.meetingId, meeting.ended, meeting.count], ['local_m2', `${TODAY}-2`, false, 2]);
});

test('unknown meeting action -> 404; state changes need our Origin', async () => {
    assert.deepEqual(await post('/api/meeting/nope'), { status: 404, body: { error: 'unknown action' } });
    assert.deepEqual(await post('/api/meeting'), { status: 404, body: { error: 'unknown action' } });
    assert.equal((await fetch(`${origin}/api/meeting/start`, { method: 'POST' })).status, 403);
});

test('guide on restart: an old version is rewritten, a same-version hand edit is kept', async () => {
    await stop();
    fs.writeFileSync(GUIDE, '<!-- claude-office guide v0 -->\n옛 지침\n');
    await start();
    assert.equal(fs.readFileSync(GUIDE, 'utf8'), facilitatorGuide({ cliPath: CLI_PATH }));

    await stop();
    const edited = `${GUIDE_HEADER}\n# 내가 고친 지침\n`;
    fs.writeFileSync(GUIDE, edited);
    await start();
    assert.equal(fs.readFileSync(GUIDE, 'utf8'), edited);
});
