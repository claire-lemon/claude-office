import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown as md } from '../../public/js/lib/markdown.js';

test('table, code fence, nested and task lists', () => {
    const out = md([
        '| # | 항목 | 결과 |',
        '|---|---|---|',
        '| 1 | **hook** | ✅ `ok` |',
        '',
        '```js',
        'const a = 1 < 2;',
        '```',
        '- a',
        '  - b',
        '- [x] done',
        '- [ ] todo',
        '1. one',
        '2. two',
    ].join('\n'));
    assert.match(out, /<table><thead><tr><th>#<\/th><th>항목<\/th><th>결과<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td><strong>hook<\/strong><\/td><td>✅ <code>ok<\/code><\/td><\/tr>/);
    assert.match(out, /<pre class="md-code" data-lang="js"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
    assert.match(out, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li class="task"><input type="checkbox" disabled checked> done<\/li><li class="task"><input type="checkbox" disabled> todo<\/li><\/ul>/);
    assert.match(out, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test('headings, quote, hr, links, paragraph line breaks', () => {
    const out = md('## 결재 보고\n> 인용\n\n---\n첫 줄\n둘째 줄 [PR](https://github.com/x/y/pull/1)');
    assert.match(out, /<h4>결재 보고<\/h4>/);
    assert.match(out, /<blockquote><p>인용<\/p><\/blockquote>/);
    assert.match(out, /<hr>/);
    assert.match(out, /<p>첫 줄<br>둘째 줄 <a href="https:\/\/github.com\/x\/y\/pull\/1" target="_blank" rel="noopener noreferrer">PR<\/a><\/p>/);
});

test('escapes HTML and refuses non-http links', () => {
    const out = md('<img src=x onerror=alert(1)> [x](javascript:alert(1)) `<b>`\n| a |\n|---|\n| <script> |');
    assert.ok(!/<img|<script|<b>|href="javascript/.test(out), out);
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('never hangs on odd input', () => {
    ['|---|', '```\nunclosed', '#nospace', '  - ', '*', '> '].forEach(s => assert.equal(typeof md(s), 'string'));
});

test('report style: numbered items with 3-space nested numbered children', () => {
    const out = md('1. `a.ts:1` 수정\n2. 검증 완료\n   1. 단위 테스트로 검증\n   2. 로컬 API 처리\n3. 없음');
    assert.equal(out, '<ol><li><code>a.ts:1</code> 수정</li><li>검증 완료<ol><li>단위 테스트로 검증</li><li>로컬 API 처리</li></ol></li><li>없음</li></ol>');
});
