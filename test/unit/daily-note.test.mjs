import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    STATUS_LABEL, AUTO_START, AUTO_END, autoSection, replaceAuto, noteSkeleton, meetingSection, appendSection,
    localDate, hhmm, startOfYesterday, NARRATIVE_START, NARRATIVE_END, narrativeInput, narrativeSection, replaceNarrative, narrationDue,
} from '../../src/domain/daily-note.mjs';

// Local-time moments so HH:MM and dates don't depend on the machine's timezone.
const at = (h, m, day = 29) => new Date(2026, 8, day, h, m).getTime();
const SINCE = at(0, 0, 28);
const DATE = '2026-09-29';
const open = { title: '회의록', project: 'web', status: 'open', latest: null, doneAt: null };
const started = { title: '결제 모듈', project: 'api', status: 'started', latest: { animal: 'rabbit', status: 'working' }, doneAt: null };
const startedLean = { title: '예전 작업', project: 'api', status: 'started', latest: { animal: 'frog', status: 'stale' }, doneAt: null };
const done = { title: '배포', project: 'infra', status: 'done', latest: null, doneAt: at(10, 7) };

test('date helpers: local date, HH:MM, yesterday 00:00 (month boundary too)', () => {
    assert.equal(localDate(at(9, 5)), DATE);
    assert.equal(hhmm(at(9, 5)), '09:05');
    assert.equal(startOfYesterday(at(9, 5)), SINCE);
    assert.equal(startOfYesterday(new Date(2026, 9, 1, 3, 0).getTime()), new Date(2026, 8, 30).getTime());
});

test('autoSection: status labels, diff stat, 📋 link, 한 줄 요약 (report, else preview), 다음 작업, 칠판 marks', () => {
    const auto = autoSection({
        date: DATE,
        since: SINCE,
        sessions: [
            {
                title: '결제 리팩터링', status: 'review', diffStat: { files: 3, add: 12, del: 4 }, todoTitle: '결제 모듈',
                report: { '한 줄 요약': '1. 결제 모듈 분리 완료\n   1. 세부 내용' }, nextTasks: [{ title: '타입 배포' }, { title: '프론트 표시' }],
            },
            { title: '질문 세션', status: 'question', report: null, preview: `브랜치를\n어디서 ${'가'.repeat(200)}`, nextTasks: [] },
            { title: '다음만', status: 'done', report: { '다음 작업': '1. x' }, nextTasks: [{ title: '후속' }] },
            { title: '예전 세션', status: 'stale' },
            { title: '보관 세션', status: 'archived', preview: '   ' },
        ],
        todos: [open, started, startedLean, done],
        folders: [{ name: 'api', path: '/r/api', lastAt: 1 }, { name: 'web', path: '/r/web', lastAt: 0 }],
    });
    assert.equal(
        auto,
        [
            AUTO_START,
            '## 어제 세션 (2026-09-28 00:00 이후)',
            '1. 결제 리팩터링 — 결재 대기 · +12 −4 · 3개 파일 · 📋 결제 모듈',
            '   1. 한 줄 요약: 결제 모듈 분리 완료',
            '   2. 다음 작업 추천: 타입 배포 / 프론트 표시',
            '2. 질문 세션 — 질문 중',
            `   1. 한 줄 요약: 브랜치를 어디서 ${'가'.repeat(120 - '브랜치를 어디서 '.length)}`,
            '3. 다음만 — 완료',
            '   1. 다음 작업 추천: 후속',
            '4. 예전 세션 — 지난 세션',
            '5. 보관 세션 — 보관',
            '## 칠판 (지금)',
            '1. ☐ 회의록 — web',
            '2. ◐ 결제 모듈 — api · 토끼 작업 중',
            '3. ◐ 예전 작업 — api · 개구리 지난 세션',
            '4. ☑ 배포 — infra · 완료 10:07',
            '## 최근 프로젝트 폴더',
            '1. api — /r/api',
            '2. web — /r/web',
            AUTO_END,
        ].join('\n'),
    );
    assert.deepEqual(Object.keys(STATUS_LABEL).sort(), ['archived', 'blocked', 'done', 'hold', 'question', 'review', 'stale', 'unknown', 'working']);
});

test('autoSection: empty sessions / 칠판 / folders read 없음', () => {
    assert.equal(
        autoSection({ date: DATE, since: SINCE, sessions: [], todos: [], folders: [] }),
        [AUTO_START, '## 어제 세션 (2026-09-28 00:00 이후)', '1. 없음', '## 칠판 (지금)', '1. 없음', '## 최근 프로젝트 폴더', '1. 없음', AUTO_END].join('\n'),
    );
});

test('replaceAuto: swaps only the marker block; text before and after (회의 1, hand notes) stays', () => {
    const oldAuto = `${AUTO_START}\n## 칠판 (지금)\n1. 없음\n${AUTO_END}`;
    const before = `${noteSkeleton(DATE)}\n손 메모\n\n`;
    const after = '\n\n## 회의 1 (09:12 ~ 09:31)\n1. 오늘 할 일 확정 0개\n';
    const next = `${AUTO_START}\n## 칠판 (지금)\n1. ☐ 회의록 — web\n${AUTO_END}`;
    assert.equal(replaceAuto(before + oldAuto + after, next, DATE), before + next + after);
    // a second run over its own output is stable
    assert.equal(replaceAuto(replaceAuto(before + oldAuto + after, next, DATE), next, DATE), before + next + after);
});

test('replaceAuto: no markers -> right after the first H1; empty or missing note -> skeleton', () => {
    const auto = `${AUTO_START}\nX\n${AUTO_END}`;
    assert.equal(replaceAuto(`${noteSkeleton(DATE)}\n손 메모\n`, auto, DATE), `${noteSkeleton(DATE)}\n${auto}\n\n손 메모\n`);
    assert.equal(replaceAuto(noteSkeleton(DATE), auto, DATE), `${noteSkeleton(DATE)}\n${auto}\n`);
    assert.equal(replaceAuto(null, auto, DATE), `${noteSkeleton(DATE)}\n${auto}\n`);
    assert.equal(replaceAuto('', auto, DATE), `${noteSkeleton(DATE)}\n${auto}\n`);
    assert.equal(noteSkeleton(DATE), '---\ndate: "2026-09-29"\ntype: office-daily\n---\n# 2026-09-29\n');
    // a start marker without an end is not a block: insert a fresh one after the H1
    assert.ok(replaceAuto(`# ${DATE}\n${AUTO_START}\n`, auto, DATE).startsWith(`# ${DATE}\n\n${auto}\n`));
});

test('meetingSection: times, confirmed todos, last message quoted line by line and cut at 1200', () => {
    assert.equal(
        meetingSection({ n: 2, startedAt: at(9, 12), endedAt: at(9, 31), todos: [open, done], lastMessage: '1. 어제 끝낸 일\n\n2. 추천\n' }),
        [
            '## 회의 2 (09:12 ~ 09:31)',
            '1. 오늘 할 일 확정 2개',
            '   1. ☐ 회의록 — web',
            '   2. ☑ 배포 — infra · 완료 10:07',
            '2. 진행자 마지막 메시지',
            '   > 1. 어제 끝낸 일',
            '   >',
            '   > 2. 추천',
        ].join('\n'),
    );
    assert.equal(meetingSection({ n: 1, startedAt: at(9, 0), endedAt: at(9, 1), todos: [], lastMessage: '' }), '## 회의 1 (09:00 ~ 09:01)\n1. 오늘 할 일 확정 0개');
    const long = meetingSection({ n: 1, startedAt: at(9, 0), endedAt: at(9, 1), todos: [], lastMessage: '가'.repeat(1500) });
    assert.equal(long.split('\n').at(-1), `   > ${'가'.repeat(1200)}`);
});

test('appendSection: exactly one blank line between, one trailing newline', () => {
    assert.equal(appendSection('a\n', 'S'), 'a\n\nS\n');
    assert.equal(appendSection('a\n\n\n', 'S\n\n'), 'a\n\nS\n');
    assert.equal(appendSection('a', 'S'), 'a\n\nS\n');
    assert.equal(appendSection(null, 'S'), 'S\n');
});

test('narrativeInput: oldest first, optional lines only when present, request head / reply tail cut', () => {
    const input = narrativeInput({
        since: SINCE,
        sessions: [
            {
                title: '결제 리팩터링', status: 'review', lastAt: at(15, 0), folder: '/r/api', branch: 'feat/pay', prs: [{ number: 7, url: 'https://gh/pr/7' }],
                diffStat: { files: 3, add: 12, del: 4 }, todoTitle: '결제 모듈', prompt: `결제 분리 ${'가'.repeat(900)}`, outcome: `${'나'.repeat(2500)}\n## 결재 보고`,
            },
            { title: '예전 세션', status: 'stale', lastAt: at(10, 30, 28), folder: '', prs: [], prompt: '', outcome: '' },
        ],
    });
    const lines = input.split('\n');
    assert.equal(lines[0], '기간: 2026-09-28 00:00 이후, 세션 2개 (오래된 순)');
    assert.equal(lines[1], '<sessions>');
    assert.deepEqual(lines.slice(2, 9), ['<session n="1">', '제목: 예전 세션', '상태: 지난 세션 · 마지막 활동 2026-09-28 10:30', '요청:', '(없음)', '마지막 응답:', '(없음)']);
    assert.deepEqual(lines.slice(10, 16), [
        '<session n="2">', '제목: 결제 리팩터링', '상태: 결재 대기 · 마지막 활동 2026-09-29 15:00', '폴더: /r/api (브랜치 feat/pay)', 'PR: https://gh/pr/7', '변경: +12 −4 · 3개 파일',
    ]);
    assert.ok(input.includes('칠판 할 일: 결제 모듈'));
    assert.ok(input.includes(`요청:\n결제 분리 ${'가'.repeat(800 - '결제 분리 '.length)}\n마지막 응답:`));
    // the reply keeps its end (결재 보고 is there), marked as cut
    assert.ok(input.includes(`마지막 응답:\n…${'나'.repeat(2000 - '\n## 결재 보고'.length)}\n## 결재 보고\n</session>`));
    assert.equal(lines.at(-2), '</sessions>');
});

test('narrativeSection: header with window, count, time; our markers and H1/H2 in model output neutralised', () => {
    const body = `## 어제\n1. **api**: 결제 분리.\n${AUTO_END}\n${NARRATIVE_END}\n# 끝`;
    assert.equal(
        narrativeSection({ at: at(5, 3), since: SINCE, count: 2, body }),
        [NARRATIVE_START, '## 어제 이야기 (AI 서술 · 2026-09-28 00:00 이후 세션 2개 · 05:03 작성)', '### 어제\n1. **api**: 결제 분리.\n\n\n### 끝', NARRATIVE_END].join('\n'),
    );
    assert.equal(narrativeSection({ at: at(5, 3), since: SINCE, count: 0, body: '  ' }).split('\n')[2], '1. 없음');
});

test('replaceNarrative: after the auto block, swapped in place later; replaceAuto keeps it', () => {
    const auto = `${AUTO_START}\nX\n${AUTO_END}`;
    const meeting = '## 회의 1 (09:12 ~ 09:31)\n1. 오늘 할 일 확정 0개\n';
    const doc = `${noteSkeleton(DATE)}\n${auto}\n\n${meeting}`;
    const one = `${NARRATIVE_START}\n1. 첫 서술\n${NARRATIVE_END}`;
    const two = `${NARRATIVE_START}\n1. 다시 쓴 서술\n${NARRATIVE_END}`;
    const first = replaceNarrative(doc, one, DATE);
    assert.equal(first, `${noteSkeleton(DATE)}\n${auto}\n\n${one}\n\n${meeting}`);
    assert.equal(replaceNarrative(first, two, DATE), `${noteSkeleton(DATE)}\n${auto}\n\n${two}\n\n${meeting}`);
    const auto2 = `${AUTO_START}\nY\n${AUTO_END}`;
    assert.equal(replaceAuto(first, auto2, DATE), `${noteSkeleton(DATE)}\n${auto2}\n\n${one}\n\n${meeting}`);
    // no auto block -> appended; no note -> skeleton first
    assert.equal(replaceNarrative(`${noteSkeleton(DATE)}손 메모\n`, one, DATE), `${noteSkeleton(DATE)}손 메모\n\n${one}\n`);
    assert.equal(replaceNarrative(null, one, DATE), `${noteSkeleton(DATE)}\n${one}\n`);
});

test('narrationDue: from the given hour on, only while the note has no narrative', () => {
    const note = `${noteSkeleton(DATE)}\n${AUTO_START}\nX\n${AUTO_END}\n`;
    assert.equal(narrationDue({ now: at(4, 59), text: note, hour: 5 }), false);
    assert.equal(narrationDue({ now: at(5, 0), text: note, hour: 5 }), true);
    assert.equal(narrationDue({ now: at(23, 0), text: null, hour: 5 }), true);
    assert.equal(narrationDue({ now: at(9, 0), text: replaceNarrative(note, `${NARRATIVE_START}\n1. 없음\n${NARRATIVE_END}`, DATE), hour: 5 }), false);
});
