import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport } from '../../src/domain/report.mjs';

test('parseReport: block, missing block, missing sections', () => {
    const r = parseReport('앞말\n## 결재 보고\n### 한 줄 요약\n요약\n### 리뷰 필요\n- a.ts:1 — 이유\n## 다른 섹션\nx');
    assert.deepEqual(r, { '한 줄 요약': '요약', '리뷰 필요': '- a.ts:1 — 이유' });
    assert.equal(parseReport('그냥 답변'), null);
    assert.deepEqual(parseReport('## 결재 보고\n'), {});
});
