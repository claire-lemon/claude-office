import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Pull the viewer straight out of the page so the test exercises the shipped code.
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const escapeLine = html.match(/^\s*const escapeHtml = .*$/m)[0];
const viewer = html.slice(html.indexOf('// ---------- markdown viewer'), html.indexOf('// ---------- kanban'));
const ctx = vm.createContext({});
vm.runInContext(`${escapeLine}\n${viewer}\nglobalThis.md = renderMarkdown;`, ctx);
const md = ctx.md;

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
