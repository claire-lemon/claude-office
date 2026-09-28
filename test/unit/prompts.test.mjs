import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from '../../src/domain/report.mjs';
import { nextTaskPrompt, newSessionLink } from '../../src/domain/prompts.mjs';

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
