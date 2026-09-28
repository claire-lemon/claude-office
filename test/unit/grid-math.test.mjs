import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatCount, assignSeats, fitGrid, resizePair } from '../../public/js/lib/grid-math.js';

const EXTRA = 36 - 14 * 86 / 64; // same desk extra height views/layout.js passes
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sum = xs => xs.reduce((a, b) => a + b, 0);

test('seatCount: design table (block 5)', () => {
    const table = { 0: 5, 3: 5, 5: 10, 7: 10, 10: 15, 12: 15, 20: 25 };
    Object.entries(table).forEach(([n, seats]) => assert.equal(seatCount(Number(n), 5), seats, `n=${n}`));
});

test('assignSeats: first fill goes in ids order, rest stay empty', () => {
    assert.deepEqual(assignSeats([], ['a', 'b', 'c'], 5), ['a', 'b', 'c', null, null]);
});

test('assignSeats: sessions keep their seat across polls, even when order changes', () => {
    const prev = ['a', 'b', 'c', null, null];
    assert.deepEqual(assignSeats(prev, ['c', 'a', 'b'], 5), prev);
});

test('assignSeats: gone sessions free their seat; new ids fill gaps first', () => {
    const prev = ['a', 'b', 'c', 'd', null];
    assert.deepEqual(assignSeats(prev, ['a', 'c', 'd', 'e', 'f'], 10), ['a', 'e', 'c', 'd', 'f', null, null, null, null, null]);
});

test('assignSeats: shrinking moves only sessions whose seat no longer exists', () => {
    const prev = ['a', null, 'c', null, null, 'f', null, null, null, null];
    assert.deepEqual(assignSeats(prev, ['a', 'c', 'f'], 5), ['a', 'f', 'c', null, null]);
});

test('fitGrid: wide and short area picks 10 columns (one row)', () => {
    const r = fitGrid({ count: 10, width: 1200, height: 250, colsOptions: [10, 5], extra: EXTRA });
    assert.equal(r.cols, 10);
    assert.ok(near(r.size, (1200 - 8 * 9) / 10));
});

test('fitGrid: narrow and tall area picks 5 columns (two rows)', () => {
    const r = fitGrid({ count: 10, width: 600, height: 600, colsOptions: [10, 5], extra: EXTRA });
    assert.equal(r.cols, 5);
    assert.ok(near(r.size, (600 - 8 * 4) / 5));
});

test('fitGrid: never more than 10 per row, size capped at max', () => {
    const r = fitGrid({ count: 25, width: 4000, height: 3000, colsOptions: [10, 5], extra: EXTRA });
    assert.equal(r.cols, 10);
    assert.equal(r.size, 150);
});

test('fitGrid: nothing fits at min size -> min size, cols by width, still capped at 10', () => {
    const narrow = fitGrid({ count: 15, width: 500, height: 140, colsOptions: [10, 5], extra: EXTRA });
    assert.deepEqual(narrow, { cols: 7, size: 56 }); // floor((500+8)/(56+8)) = 7
    const wide = fitGrid({ count: 25, width: 3000, height: 100, colsOptions: [10, 5], extra: EXTRA });
    assert.deepEqual(wide, { cols: 10, size: 56 });
    const tiny = fitGrid({ count: 5, width: 30, height: 30, colsOptions: [10, 5], extra: EXTRA });
    assert.deepEqual(tiny, { cols: 1, size: 56 });
});

test('fitGrid: Infinity height fits by width only', () => {
    const r = fitGrid({ count: 10, width: 700, height: Infinity, colsOptions: [10, 5], extra: EXTRA });
    assert.equal(r.cols, 5);
    assert.ok(near(r.size, (700 - 8 * 4) / 5));
});

test('fitGrid: options above count are skipped; none left -> [count]; count 0 -> empty', () => {
    assert.equal(fitGrid({ count: 5, width: 2000, height: 200, colsOptions: [10, 5], extra: EXTRA }).cols, 5);
    assert.equal(fitGrid({ count: 3, width: 2000, height: 200, colsOptions: [10, 5], extra: EXTRA }).cols, 3);
    assert.deepEqual(fitGrid({ count: 0, width: 800, height: 300, colsOptions: [10, 5] }), { cols: 0, size: 0 });
});

test('resizePair: pair trades dx, pair sum kept, others untouched', () => {
    const fracs = [1, 1, 1, 1];
    const next = resizePair(fracs, 1, 60, 1000, 160); // 250px each -> 310px / 190px
    assert.ok(near(next[1], 1.24));
    assert.ok(near(next[2], 0.76));
    assert.equal(next[0], 1);
    assert.equal(next[3], 1);
    assert.ok(near(sum(next), 4));
    assert.deepEqual(fracs, [1, 1, 1, 1]); // input not mutated
});

test('resizePair: neither column goes below min', () => {
    const grow = resizePair([1, 1, 1, 1], 0, 1000, 1000, 160); // col 1 floors at 160px = 0.64fr
    assert.ok(near(grow[1], 0.64));
    assert.ok(near(grow[0] + grow[1], 2));
    const shrink = resizePair([1, 1, 1, 1], 0, -1000, 1000, 160);
    assert.ok(near(shrink[0], 0.64));
    assert.ok(near(shrink[0] + shrink[1], 2));
});

test('resizePair: out-of-range index returns an unchanged copy', () => {
    assert.deepEqual(resizePair([1, 2], 1, 50, 600, 160), [1, 2]);
});
