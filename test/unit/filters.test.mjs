import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILTERS, filterById, pendingAlert } from '../../public/js/views/filters.js';
import { COLUMNS } from '../../public/js/views/columns.js';
import { columnOf } from '../../src/domain/board.mjs';

const session = status => ({ id: status, status, column: columnOf(status) });
const STATUSES = ['working', 'review', 'question', 'blocked', 'hold', 'done', 'unknown'];

test('FILTERS: all first, unique ids, unknown id falls back to all', () => {
    assert.equal(FILTERS[0].id, 'all');
    const ids = FILTERS.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(filterById('nope'), FILTERS[0]);
    assert.equal(filterById('hold').id, 'hold');
});

test('FILTERS: all matches everything', () => {
    assert.ok(STATUSES.map(session).every(filterById('all').match));
});

test('FILTERS: pending counts every 결재 대기 status incl. blocked (by column)', () => {
    const matched = STATUSES.map(session).filter(filterById('pending').match).map(s => s.status);
    assert.deepEqual(matched, ['review', 'question', 'blocked']);
    assert.deepEqual(STATUSES.map(session).filter(filterById('hold').match).map(s => s.status), ['hold']);
});

test('FILTERS: every columns entry is a board column', () => {
    const cols = new Set(COLUMNS.map(c => c.id));
    FILTERS.filter(f => f.columns).forEach(f => f.columns.forEach(c => assert.ok(cols.has(c), `${f.id}: ${c}`)));
});

test('pendingAlert: same count as the 결재 대기 counter (blocked included); only new arrivals are fresh', () => {
    const list = STATUSES.map(session);
    const first = pendingAlert(list, null);
    assert.equal(first.count, list.filter(filterById('pending').match).length);
    assert.deepEqual(first.ids, ['review', 'question', 'blocked']);
    assert.deepEqual(first.fresh, []); // page load never rings
    const blockedLater = pendingAlert(list, ['review', 'question']);
    assert.deepEqual(blockedLater.fresh, ['blocked']); // a newly blocked session rings too
    assert.deepEqual(pendingAlert(list, first.ids).fresh, []);
    // one leaves, another arrives: the count stays 1 but the arrival still rings
    assert.deepEqual(pendingAlert([session('review')], ['blocked']), { count: 1, ids: ['review'], fresh: ['review'] });
});
