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

test('frontmatter: note-header YAML becomes a key/value table, body renders below', async () => {
    const { splitFrontmatter, renderDocument } = await import('../../public/js/lib/markdown.js');
    const doc = [
        '---',
        'type: query-output',
        'created: "2026-09-28"',
        "question: 'A <b>long</b> question?'",
        'sources:',
        '  - "[[notes/plan|Plan v3]] — the template"',
        '  - "[[notes/raw]]"',
        'pr:',
        'tags: [consulting, serverless]',
        'summary: |',
        '  first line',
        '  second line',
        '---',
        '',
        '# Title',
    ].join('\n');
    const { meta, body } = splitFrontmatter(doc);
    assert.deepEqual(meta, [
        { key: 'type', value: 'query-output' },
        { key: 'created', value: '2026-09-28' },
        { key: 'question', value: 'A <b>long</b> question?' },
        { key: 'sources', value: ['[[notes/plan|Plan v3]] — the template', '[[notes/raw]]'] },
        { key: 'pr', value: '' },
        { key: 'tags', value: ['consulting', 'serverless'] },
        { key: 'summary', value: 'first line second line' },
    ]);
    assert.equal(body, '\n# Title');
    const out = renderDocument(doc);
    assert.match(out, /^<div class="md-table md-frontmatter"><table><tbody><tr><th>type<\/th><td>query-output<\/td><\/tr>/);
    assert.match(out, /<th>question<\/th><td>A &lt;b&gt;long&lt;\/b&gt; question\?<\/td>/); // escaped, never HTML
    assert.match(out, /<th>sources<\/th><td><ul><li>Plan v3 — the template<\/li><li>notes\/raw<\/li><\/ul><\/td>/); // wiki links -> labels
    assert.match(out, /<th>pr<\/th><td><span class="md-fm-empty">-<\/span><\/td>/);
    assert.match(out, /<\/table><\/div><h3>Title<\/h3>$/);
});

test('frontmatter: a leading --- rule or an unclosed block is left to the markdown renderer', async () => {
    const { splitFrontmatter, renderDocument } = await import('../../public/js/lib/markdown.js');
    const rule = '---\nJust a paragraph after a rule.\n---\nmore';
    assert.equal(splitFrontmatter(rule).meta, null);
    assert.equal(renderDocument(rule), md(rule));
    assert.equal(splitFrontmatter('---\ntype: note\nno closing line').meta, null);
    assert.equal(splitFrontmatter('# no frontmatter').meta, null);
    assert.equal(splitFrontmatter('---\n---\nbody').meta, null);
});

test('file preview body: wiki links show their label, code keeps them literal, report tab untouched', async () => {
    const { renderDocument } = await import('../../public/js/lib/markdown.js');
    const body = [
        'See [[notes/plan|Plan v3]] and [[notes/raw]] ![[img.png]].',
        '',
        '| 문서 | 비고 |',
        '|---|---|',
        '| [[notes/a\\|목차 분석]] | ok |',
        '',
        'Inline `[[keep|me]]` stays.',
        '```',
        'if [[ -f x ]]; then echo; fi',
        '```',
    ].join('\n');
    const out = renderDocument(body);
    assert.match(out, /<p>See Plan v3 and notes\/raw img\.png\.<\/p>/);
    assert.match(out, /<td>목차 분석<\/td><td>ok<\/td>/); // escaped \| inside a table cell
    assert.match(out, /<code>\[\[keep\|me\]\]<\/code>/);
    assert.match(out, /<pre class="md-code"><code>if \[\[ -f x \]\]; then echo; fi<\/code><\/pre>/);
    assert.match(md('See [[notes/plan|Plan v3]]'), /\[\[notes\/plan\|Plan v3\]\]/); // renderMarkdown (report tab) unchanged
});
