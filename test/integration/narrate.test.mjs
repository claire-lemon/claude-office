import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 오늘 일지 AI 서술 against its own fixture home, no server: the timer entry (narrateIfDue) with a fake model
// call, then the CLI `narrate` with a fake `claude` on PATH. config.mjs reads env at import time.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-narrate-'));
process.env.OFFICE_HOME = HOME;
const { OFFICE_DIR, NARRATE_HOUR, NARRATE_AUTO } = await import('../../src/config.mjs');
const { narrateIfDue } = await import('../../src/usecases/narrate.mjs');
const { NARRATIVE_SYSTEM } = await import('../../src/domain/prompts.mjs');
const { meetingPrompt } = await import('../../src/domain/meeting.mjs');
const { localDate, NARRATIVE_START, AUTO_END, appendSection } = await import('../../src/domain/daily-note.mjs');

const day = new Date();
const today = h => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime();
const TODAY = localDate(today(12));
const NOTE = path.join(OFFICE_DIR, 'daily', `${TODAY}.md`);
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const STATE = path.join(OFFICE_DIR, 'state');
const repo = path.join(HOME, 'repos', 'api');
const BIN = path.join(HOME, 'bin');
[APP, STATE, repo, BIN, path.join(HOME, 't')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const app = (id, cli, folder, lastActivityAt, title) =>
    fs.writeFileSync(path.join(APP, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: cli, title, cwd: folder, originCwd: folder, lastActivityAt, isArchived: false, prs: [] }));
const state = (cli, at, cwd, transcriptPath) => fs.writeFileSync(path.join(STATE, `${cli}.json`), JSON.stringify({ event: 'Stop', at, cwd, transcriptPath }));
const line = o => `${JSON.stringify(o)}\n`;
const transcript = (cli, ...lines) => {
    const file = path.join(HOME, 't', `${cli}.jsonl`);
    fs.writeFileSync(file, lines.join(''));
    return file;
};
const assistant = text => line({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const note = () => fs.readFileSync(NOTE, 'utf8');

// A work session shaped like a real transcript (app preamble, reminder block before the prompt, tool result),
// a facilitator (a meeting, not work) and a session from three days ago (outside the window).
const tW = transcript(
    'cli-w',
    line({ type: 'queue-operation' }),
    line({ type: 'attachment' }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>\n앱 안내\n</system-reminder>' }, { type: 'text', text: '결제 모듈 분리해줘' }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ls 결과' }] } }),
    assistant('## 결재 보고\n### 한 줄 요약\n1. 결제 분리 완료'),
);
app('local_w', 'cli-w', repo, Date.now() - 60_000, 'W 세션');
state('cli-w', Date.now() - 30_000, repo, tW);
const tM = transcript('cli-m', line({ type: 'user', message: { role: 'user', content: meetingPrompt(`${TODAY}-1`, NOTE, 'guide') } }), assistant('회의 메시지'));
app('local_m', 'cli-m', OFFICE_DIR, Date.now(), '진행자');
state('cli-m', Date.now(), OFFICE_DIR, tM);
app('local_old', 'cli-old', repo, Date.now() - 3 * 24 * 3600 * 1000, '옛 세션');

test('the server timer never runs for a fixture home', () => {
    assert.equal(NARRATE_AUTO, false);
});

test('narrateIfDue: nothing before NARRATE_HOUR, once after it, then not again that day', async () => {
    const calls = [];
    const run = async (input, system, timeout) => (calls.push({ input, system, timeout }), '1. **api**: 결제 모듈을 나눴다.\n2. **남은 것**\n   1. 없음');
    assert.equal(await narrateIfDue(today(NARRATE_HOUR - 1), run), null);
    assert.equal(calls.length, 0);
    assert.ok(!fs.existsSync(NOTE));

    const done = await narrateIfDue(today(NARRATE_HOUR + 1), run);
    assert.deepEqual(done, { note: NOTE, sessions: 1 });
    assert.equal(calls.length, 1);
    const [{ input, system, timeout }] = calls;
    assert.equal(system, NARRATIVE_SYSTEM);
    assert.ok(timeout > 60000);
    assert.match(input, /<session n="1">\n제목: W 세션\n/);
    assert.ok(input.includes('요청:\n결제 모듈 분리해줘\n'), 'first prompt without the reminder block');
    assert.ok(input.includes('마지막 응답:\n## 결재 보고\n### 한 줄 요약\n1. 결제 분리 완료\n</session>'));
    assert.ok(!input.includes('진행자') && !input.includes('옛 세션'));
    const text = note();
    assert.ok(text.indexOf(AUTO_END) < text.indexOf(NARRATIVE_START), 'narrative after the auto block');
    assert.ok(text.includes('이후 세션 1개'));
    assert.ok(text.includes('1. **api**: 결제 모듈을 나눴다.'));

    assert.equal(await narrateIfDue(today(NARRATE_HOUR + 2), run), null);
    assert.equal(calls.length, 1);
});

const fakeClaude = script => {
    fs.writeFileSync(path.join(BIN, 'claude'), `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
    const r = spawnSync('node', [path.join(ROOT, 'bin/office.mjs'), 'narrate'], {
        env: { ...process.env, OFFICE_HOME: HOME, PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
        encoding: 'utf8',
    });
    return { code: r.status, out: JSON.parse(r.stdout) };
};

test('CLI narrate: rewrites the narrative in place, keeps 회의 sections; a failed model call leaves the note', () => {
    fs.writeFileSync(NOTE, appendSection(note(), '## 회의 1 (09:00 ~ 09:10)\n1. 오늘 할 일 확정 0개'));
    const log = path.join(HOME, 'call.json');
    const ok = fakeClaude(`const fs = require('fs');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), input: fs.readFileSync(0, 'utf8') }));
process.stdout.write('1. **api**: 다시 쓴 이야기.');`);
    assert.equal(ok.code, 0, JSON.stringify(ok.out));
    assert.deepEqual(ok.out, { note: NOTE, sessions: 1 });
    const call = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.equal(call.args[call.args.indexOf('--system-prompt') + 1], NARRATIVE_SYSTEM);
    assert.match(call.input, /<sessions>[\s\S]*<\/sessions>/);
    const text = note();
    assert.equal(text.split(NARRATIVE_START).length, 2, 'one narrative block');
    assert.ok(text.includes('1. **api**: 다시 쓴 이야기.') && !text.includes('결제 모듈을 나눴다'));
    assert.ok(text.trimEnd().endsWith('## 회의 1 (09:00 ~ 09:10)\n1. 오늘 할 일 확정 0개'));

    const failed = fakeClaude("process.stderr.write('not logged in'); process.exit(1);");
    assert.equal(failed.code, 1);
    assert.ok(failed.out.error);
    assert.ok(note().includes('1. **api**: 다시 쓴 이야기.'));
});
