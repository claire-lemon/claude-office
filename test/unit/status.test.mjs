import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus } from '../../src/domain/status.mjs';

test('deriveStatus: every row of the mapping, decisions win until a newer event', () => {
    const s = (event, at = 10) => ({ event, at });
    const d = (kind, at = 11) => ({ kind, at });
    assert.equal(deriveStatus({ state: null }), 'unknown');
    assert.equal(deriveStatus({ state: s('UserPromptSubmit') }), 'working');
    assert.equal(deriveStatus({ state: s('Notification') }), 'blocked');
    assert.equal(deriveStatus({ state: s('Stop'), hasReport: true }), 'review');
    assert.equal(deriveStatus({ state: s('Stop'), hasReport: false }), 'question');
    assert.equal(deriveStatus({ state: s('Stop'), hasReport: true, decision: d('confirm') }), 'done');
    assert.equal(deriveStatus({ state: s('Stop'), decision: d('hold') }), 'hold');
    assert.equal(deriveStatus({ state: s('Stop'), decision: d('archive') }), 'archived');
    assert.equal(deriveStatus({ state: null, decision: d('hold') }), 'hold');
    assert.equal(deriveStatus({ state: s('UserPromptSubmit', 12), decision: d('hold') }), 'working');
});
