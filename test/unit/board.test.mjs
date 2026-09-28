import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMN_OF, MOVE_RULES, columnOf, movesFor, resolveMove } from '../../src/domain/board.mjs';
import { COLUMNS, MOVE_HINT, MOVE_TOAST } from '../../public/js/views/columns.js';

test('columnOf: every status', () => {
    assert.equal(columnOf('working'), 'working');
    assert.equal(columnOf('review'), 'pending');
    assert.equal(columnOf('question'), 'pending');
    assert.equal(columnOf('blocked'), 'pending');
    assert.equal(columnOf('hold'), 'hold');
    assert.equal(columnOf('done'), 'done');
    assert.equal(columnOf('unknown'), null);
    assert.equal(columnOf('archived'), null);
});

test('movesFor: every row of the drop table', () => {
    // every card on the board can also go to the 보관함 button (last row of the table)
    const to = (status, baseStatus) => movesFor({ status, baseStatus }).map(m => `${m.to}:${m.action}`).filter(m => m !== 'archive:archive');
    ['working', 'review', 'question', 'blocked', 'hold', 'done'].forEach(s =>
        assert.equal(movesFor({ status: s, baseStatus: 'review' }).at(-1).to, 'archive'));
    // working: hold only (never straight to done, the next hook event would pull it back)
    assert.deepEqual(to('working', 'working'), ['hold:hold']);
    // pending (any of the three statuses): hold or done
    ['review', 'question', 'blocked'].forEach(s => assert.deepEqual(to(s, s), ['hold:hold', 'done:confirm']));
    // hold: done, or undo back to the base column
    assert.deepEqual(to('hold', 'review'), ['done:confirm', 'pending:undo']);
    assert.deepEqual(to('hold', 'working'), ['done:confirm', 'working:undo']);
    // done: hold, or undo back to the base column
    assert.deepEqual(to('done', 'question'), ['hold:hold', 'pending:undo']);
    assert.deepEqual(to('done', 'working'), ['hold:hold', 'working:undo']);
    // no base column (no hook state yet) -> no undo
    assert.deepEqual(to('hold', 'unknown'), ['done:confirm']);
    // off the board -> nothing
    assert.deepEqual(to('unknown', 'unknown'), []);
    // never a move into the column the card is already in
    ['working', 'review', 'hold', 'done'].forEach(s => assert.ok(!movesFor({ status: s, baseStatus: 'review' }).some(m => m.to === columnOf(s))));
});

test('resolveMove: finds the move for a column or null', () => {
    const moves = movesFor({ status: 'review', baseStatus: 'review' });
    assert.deepEqual(resolveMove(moves, 'done'), { to: 'done', action: 'confirm' });
    assert.equal(resolveMove(moves, 'working'), null);
    assert.equal(resolveMove(moves, null), null);
    assert.equal(resolveMove(movesFor({ status: 'working', baseStatus: 'working' }), 'done'), null);
});

// The client tables must follow the server rules: a column or action added on one side only would
// render nowhere or drop with no label.
test('client COLUMNS ids = server column ids', () => {
    const ids = COLUMNS.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, 'unique column ids');
    assert.deepEqual(new Set(ids), new Set(Object.values(COLUMN_OF)));
});

test('every server move action has a drag hint and a toast', () => {
    MOVE_RULES.forEach(r => {
        assert.ok(MOVE_HINT[r.action], `MOVE_HINT.${r.action}`);
        assert.ok(MOVE_TOAST[r.action], `MOVE_TOAST.${r.action}`);
    });
});

test('client pending sort: blocked, review, question', () => {
    const pending = COLUMNS.find(c => c.id === 'pending');
    const list = ['question', 'review', 'blocked', 'review'].map((status, i) => ({ id: String(i), status }));
    assert.deepEqual([...list].sort(pending.sort).map(s => s.status), ['blocked', 'review', 'review', 'question']);
});
