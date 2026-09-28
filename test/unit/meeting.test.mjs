import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEETING_MARK, meetingId, meetingMarker, meetingIdIn, meetingPrompt, GUIDE_VERSION, GUIDE_HEADER, facilitatorGuide } from '../../src/domain/meeting.mjs';
import { NEXT_PROMPT_LIMIT } from '../../src/domain/prompts.mjs';

test('meeting marker: id format, found in a transcript head, other dates kept, absent -> null', () => {
    assert.equal(meetingId('2026-09-29', 1), '2026-09-29-1');
    assert.equal(meetingMarker('2026-09-29-1'), '🏫 데일리 스크럼 #meeting-2026-09-29-1');
    assert.equal(meetingIdIn(`{"type":"user","message":{"content":"${meetingMarker(meetingId('2026-09-29', 12))}\\n오늘 일지"}}`), '2026-09-29-12');
    // the usecase filters by today's date prefix; the domain only reads the id
    assert.equal(meetingIdIn('#meeting-2026-09-28-3'), '2026-09-28-3');
    ['', null, undefined, '#meeting-2026-09-29', '#meeting-2026-9-29-1', '#meeting-2026-09-29-1x', '#todo-abc123'].forEach(t => assert.equal(meetingIdIn(t), null, String(t)));
    assert.ok(MEETING_MARK.test('#meeting-2026-09-29-1'));
});

test('meetingPrompt: marker first line, note path, CLAUDE.md pointer, within the deep-link limit', () => {
    const id = meetingId('2026-09-29', 1);
    const note = '/Users/me/.claude/office/daily/2026-09-29.md';
    const guide = '/Users/me/.claude/office/CLAUDE.md';
    const prompt = meetingPrompt(id, note, guide);
    // guide path first: the app may open a scratch workspace, so CLAUDE.md is read by path, not by cwd
    assert.equal(prompt, `${meetingMarker(id)}\n지침: ${guide}\n오늘 일지: ${note}\n지침 파일을 먼저 읽고 그대로 회의를 시작해줘. 지침과 일지 외의 파일은 읽지 마.`);
    assert.ok(prompt.length <= NEXT_PROMPT_LIMIT);
    assert.equal(meetingIdIn(prompt), id);
});

test('facilitatorGuide: version header first, all five CLI commands with the path, the hard rules', () => {
    const cliPath = '/Users/me/claude-office/bin/office.mjs';
    const guide = facilitatorGuide({ cliPath });
    assert.equal(GUIDE_VERSION, 2);
    assert.equal(GUIDE_HEADER, `<!-- claude-office guide v${GUIDE_VERSION} -->`);
    assert.equal(guide.split('\n')[0], GUIDE_HEADER);
    ['todo list', 'todo add', 'todo update', 'todo delete', 'folders'].forEach(cmd => assert.ok(guide.includes(`node ${cliPath} ${cmd}`), cmd));
    ['금지', '레포', '볼트', 'git', '--source scrum', '최근 프로젝트 폴더', '중복 추가 금지', 'exit 1', '"error"'].forEach(w => assert.ok(guide.includes(w), w));
    assert.ok(!guide.includes('## 결재 보고'));
    assert.ok(guide.split('\n').length <= 90);
});
