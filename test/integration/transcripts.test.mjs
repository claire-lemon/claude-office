import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lastAssistantText } from '../../src/sources/transcripts.mjs';
import { parseReport } from '../../src/domain/report.mjs';

test('lastAssistantText finds a last reply bigger than the tail window', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-big-')), 't.jsonl');
    const line = text => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
    const big = `## 결재 보고\n### 한 줄 요약\n1. 큰 보고 완료\n${'x'.repeat(300 * 1024)}`;
    fs.writeFileSync(file, line('## 결재 보고\n### 한 줄 요약\n1. 예전 보고') + line(big));
    const text = lastAssistantText(file);
    assert.equal(text.length, big.length);
    assert.equal(parseReport(text)['한 줄 요약'].split('\n')[0], '1. 큰 보고 완료');
});
