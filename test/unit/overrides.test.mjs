import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePatch, mergeOverride } from '../../src/domain/overrides.mjs';

const title = raw => normalizePatch({ title: raw }).patch.title;

test('normalizePatch: cleans titles', () => {
    assert.equal(title('  결제 모듈  '), '결제 모듈');
    assert.equal(title('결제\n모듈\r\n리팩터링\t끝'), '결제 모듈 리팩터링 끝');
    assert.equal(title('a\u0000b\u001fc\u007fd'), 'a b c d');
    assert.equal(title('a    b'), 'a b');
    // 80 code points, Korean counted as one each; a cut that ends on a space is trimmed
    assert.equal([...title('가'.repeat(100))].length, 80);
    assert.equal(title(`${'가'.repeat(79)} 나`), '가'.repeat(79));
    assert.equal([...title('😀'.repeat(90))].length, 80);
});

test('normalizePatch: empty and null reset the field', () => {
    assert.deepEqual(normalizePatch({ title: '' }), { ok: true, patch: { title: null } });
    assert.deepEqual(normalizePatch({ title: ' \n\t ' }), { ok: true, patch: { title: null } });
    assert.deepEqual(normalizePatch({ title: null }), { ok: true, patch: { title: null } });
});

test('normalizePatch: rejects bad input', () => {
    assert.deepEqual(normalizePatch({ color: 'red' }), { ok: false, error: 'unknown field: color' });
    assert.deepEqual(normalizePatch({ title: 'x', color: 'red' }), { ok: false, error: 'unknown field: color' });
    assert.deepEqual(normalizePatch(JSON.parse('{"__proto__":"x"}')), { ok: false, error: 'unknown field: __proto__' });
    assert.deepEqual(normalizePatch({ title: 123 }), { ok: false, error: 'title must be a string' });
    assert.deepEqual(normalizePatch({ title: ['a'] }), { ok: false, error: 'title must be a string' });
    [null, 'x', 1, ['title']].forEach(raw => assert.deepEqual(normalizePatch(raw), { ok: false, error: 'body must be an object' }));
    assert.deepEqual(normalizePatch({}), { ok: false, error: 'empty patch' });
});

test('mergeOverride: merges, drops reset fields, null when nothing is left', () => {
    assert.deepEqual(mergeOverride(undefined, { title: '새 이름' }, 5), { title: '새 이름', at: 5 });
    assert.deepEqual(mergeOverride({ title: 'old', memo: 'm', at: 1 }, { title: 'new' }, 5), { title: 'new', memo: 'm', at: 5 });
    assert.deepEqual(mergeOverride({ title: 'old', memo: 'm', at: 1 }, { title: null }, 5), { memo: 'm', at: 5 });
    assert.equal(mergeOverride({ title: 'old', at: 1 }, { title: null }, 5), null);
    assert.equal(mergeOverride(undefined, { title: null }, 5), null);
});
