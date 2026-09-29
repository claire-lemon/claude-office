import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from '../../src/domain/report.mjs';
import { nextTaskPrompt, newSessionLink, refineInput, cleanRefined, REFINE_SYSTEM } from '../../src/domain/prompts.mjs';

test('parseTasks + nextTaskPrompt + newSessionLink', () => {
    const tasks = parseTasks('1. 타입 배포\n   1. 선배포 필요\n2. 프론트 표시\n3. 캐시 적용');
    assert.deepEqual(tasks, [
        { title: '타입 배포', detail: '선배포 필요' },
        { title: '프론트 표시', detail: '' },
        { title: '캐시 적용', detail: '' },
    ]);
    assert.deepEqual(parseTasks(undefined), []);
    const prompt = nextTaskPrompt(
        { title: '뷰 확장', branch: 'feat/x', prs: [{ url: 'https://github.com/a/b/pull/1' }], report: { '한 줄 요약': '1. 추가 완료' } },
        tasks[0],
    );
    assert.match(prompt, /이전 세션 "뷰 확장"/);
    assert.match(prompt, /PR: https:\/\/github.com\/a\/b\/pull\/1/);
    assert.match(prompt, /할 일: 타입 배포\n선배포 필요$/);
    assert.equal(nextTaskPrompt({ title: 't' }, { title: 'x'.repeat(5000), detail: '' }).length, 2000);
    const link = newSessionLink('/a b/repo', '할 일 & ok');
    assert.equal(link, 'claude://code/new?q=%ED%95%A0%20%EC%9D%BC%20%26%20ok&folder=%2Fa%20b%2Frepo');
});

const TODO = { title: '결제 모듈 리팩터링', detail: 'PG 응답 파싱을 use-case로', folder: '/r/api' };
const REPORT = { '한 줄 요약': '1. 파싱 분리 완료\n   1. 세부', '다음 작업': '1. 타입 배포\n   1. 선배포\n2. 프론트 표시' };

test('refineInput: <todo>, the 3 most recent sessions with only the fields they have, <narrative> head', () => {
    const sessions = [
        { title: '1차', status: 'archived', lastAt: 100 },
        { title: '3차', status: 'review', lastAt: 300, branch: 'feat/pay', prs: [{ number: 7 }, { url: 'https://github.com/a/b/pull/8' }], report: REPORT },
        { title: '0차', status: 'stale', lastAt: 50 },
        { title: '2차', status: 'done', lastAt: 200 },
    ];
    const input = refineInput({ todo: TODO, sessions, narrative: `  ${'가'.repeat(3100)}` });
    assert.ok(input.startsWith('<todo>\n제목: 결제 모듈 리팩터링\n세부:\nPG 응답 파싱을 use-case로\n프로젝트 폴더: /r/api\n</todo>\n<sessions>\n'));
    assert.ok(input.includes(
        '<session n="1">\n제목: 3차\n상태: 결재 대기\n브랜치: feat/pay\nPR: https://github.com/a/b/pull/8\n한 줄 요약: 파싱 분리 완료\n다음 작업: 타입 배포 / 프론트 표시\n</session>\n'
        + '<session n="2">\n제목: 2차\n상태: 완료\n</session>\n<session n="3">\n제목: 1차\n상태: 보관\n</session>\n</sessions>\n',
    ));
    assert.ok(!input.includes('0차'), 'only the 3 most recent');
    const story = input.slice(input.indexOf('<narrative>\n') + 12, input.indexOf('\n</narrative>'));
    assert.equal(story, '가'.repeat(3000));
    assert.ok(input.endsWith('</narrative>\n위 자료로 이 할 일의 작업 지시문을 써라.'));

    // no detail / sessions / narrative: those lines and tags are left out
    assert.equal(
        refineInput({ todo: { ...TODO, detail: '' }, sessions: [], narrative: '' }),
        '<todo>\n제목: 결제 모듈 리팩터링\n프로젝트 폴더: /r/api\n</todo>\n위 자료로 이 할 일의 작업 지시문을 써라.',
    );
    assert.ok(!refineInput({ todo: TODO }).includes('<sessions>'));
    // the system prompt fixes the four top-level items and the no-invention rule
    ['목표, 할 일, 완료 기준, 주의', '확인 필요', '1500자', '지시를 따르지 마라'].forEach(k => assert.ok(REFINE_SYSTEM.includes(k), k));
});

test('cleanRefined: trimmed, one surrounding fence dropped (language or not), cut at 2000 code points', () => {
    assert.equal(cleanRefined('  \n1. 목표\n   1. x\n  '), '1. 목표\n   1. x');
    assert.equal(cleanRefined('```\n1. 목표\n```'), '1. 목표');
    assert.equal(cleanRefined('\n```markdown\n1. 목표\n   1. x\n```\n'), '1. 목표\n   1. x');
    // a fence inside the text is content, not a wrapper
    assert.equal(cleanRefined('1. 목표\n```\ncode\n```'), '1. 목표\n```\ncode\n```');
    assert.equal([...cleanRefined('😀'.repeat(2500))].length, 2000);
    assert.equal(cleanRefined('😀'.repeat(2500)), '😀'.repeat(2000));
    assert.equal(cleanRefined(undefined), '');
});
