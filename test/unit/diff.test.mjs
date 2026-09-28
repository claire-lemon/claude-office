import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPatch } from '../../src/domain/diff.mjs';

const PATCH = [
    'diff --git a/foo.txt b/foo.txt',
    'index abc123..def456 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-old line',
    '+new line',
    ' keep2',
    'diff --git a/bar.txt b/bar.txt',
    'new file mode 100644',
    'index 0000000..111111',
    '--- /dev/null',
    '+++ b/bar.txt',
    '@@ -0,0 +1,2 @@',
    '+hello',
    '+world',
    'diff --git a/baz.txt b/baz.txt',
    'deleted file mode 100644',
    'index 222222..0000000',
    '--- a/baz.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-bye',
    '-bye2',
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
    'diff --git a/img.png b/img.png',
    'index 333333..444444 100644',
    'Binary files a/img.png and b/img.png differ',
    '',
].join('\n');

test('splitPatch: status per file (modified/added/deleted/renamed), binary detection', () => {
    const files = splitPatch(PATCH);
    assert.deepEqual(
        files.map(f => f.path),
        ['foo.txt', 'bar.txt', 'baz.txt', 'new.txt', 'img.png'],
    );
    assert.deepEqual(
        files.map(f => f.status),
        ['modified', 'added', 'deleted', 'renamed', 'modified'],
    );
    assert.deepEqual(
        files.map(f => f.binary),
        [false, false, false, false, true],
    );
});

test('splitPatch: +/- counts exclude the +++/--- file headers', () => {
    const [foo, bar, baz, renamed, img] = splitPatch(PATCH);
    assert.deepEqual([foo.add, foo.del], [1, 1]);
    assert.deepEqual([bar.add, bar.del], [2, 0]);
    assert.deepEqual([baz.add, baz.del], [0, 2]);
    assert.deepEqual([renamed.add, renamed.del], [0, 0]);
    assert.deepEqual([img.add, img.del], [0, 0]);
});

test('splitPatch: path/patch meaning is unchanged from the original diffFor (backward compatible)', () => {
    const [foo] = splitPatch(PATCH);
    assert.equal(foo.path, 'foo.txt');
    assert.ok(foo.patch.startsWith('diff --git a/foo.txt b/foo.txt\n'));
    assert.ok(foo.patch.includes('+new line'));
});

test('splitPatch: empty input returns no files, and garbage input never throws', () => {
    assert.deepEqual(splitPatch(''), []);
    assert.deepEqual(splitPatch(undefined), []);
    assert.doesNotThrow(() => splitPatch('not a patch at all'));
});
