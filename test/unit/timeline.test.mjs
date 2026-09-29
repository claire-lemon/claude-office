import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingSince, lastTurnMs } from '../../src/domain/timeline.mjs';
import { COLUMNS } from '../../public/js/views/columns.js';

const ev = (event, at) => ({ event, at });

test('pendingSince: first event of the trailing run; falls back to state.at when history does not match', () => {
    const h = [ev('UserPromptSubmit', 10), ev('Notification', 20), ev('Notification', 30)];
    assert.equal(pendingSince(h, ev('Notification', 30)), 20); // two permission prompts: waiting since the first
    assert.equal(pendingSince([ev('UserPromptSubmit', 10), ev('Notification', 20), ev('Stop', 40)], ev('Stop', 40)), 40);
    assert.equal(pendingSince([ev('Stop', 40), ev('Stop', 50)], ev('Stop', 50)), 40); // whole history is one run
    assert.equal(pendingSince([], ev('Stop', 50)), 50); // no history yet (installed before this hook version)
    assert.equal(pendingSince([ev('Stop', 40)], ev('Stop', 50)), 50); // history behind the state
    assert.equal(pendingSince(h, null), null);
});

test('lastTurnMs: last Stop minus the first prompt after the previous Stop', () => {
    assert.equal(lastTurnMs([ev('UserPromptSubmit', 100), ev('UserPromptSubmit', 150), ev('Notification', 200), ev('Stop', 400)]), 300);
    assert.equal(lastTurnMs([ev('UserPromptSubmit', 0), ev('Stop', 50), ev('UserPromptSubmit', 100), ev('Stop', 160), ev('UserPromptSubmit', 200)]), 60);
    assert.equal(lastTurnMs([ev('UserPromptSubmit', 0)]), null); // first turn still running
    assert.equal(lastTurnMs([ev('UserPromptSubmit', 0), ev('Stop', 50), ev('Stop', 90)]), 90); // a Stop hook continued the turn
    assert.equal(lastTurnMs([ev('Stop', 50), ev('Stop', 90)]), null); // no prompt at all
    assert.equal(lastTurnMs([]), null);
});

test('결재 대기 sort: longest waiting first, status rank breaks ties and orders cards without a time', () => {
    const sort = COLUMNS.find(c => c.id === 'pending').sort;
    const cards = [
        { id: 'a', status: 'review', pendingSince: 300 },
        { id: 'b', status: 'question', pendingSince: 100 },
        { id: 'c', status: 'blocked', pendingSince: 300 },
        { id: 'd', status: 'blocked', pendingSince: null },
        { id: 'e', status: 'question' },
    ];
    assert.deepEqual([...cards].sort(sort).map(c => c.id), ['b', 'c', 'a', 'd', 'e']);
});
