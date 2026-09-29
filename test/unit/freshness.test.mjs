import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessLabel } from '../../public/js/views/freshness.js';

test('freshnessLabel: connecting, seconds/minutes since the last good poll, offline keeps the data age', () => {
    const now = 1_000_000;
    assert.deepEqual(freshnessLabel({ okAt: null, failed: false }, now), { text: '연결 중…', offline: false });
    assert.deepEqual(freshnessLabel({ okAt: now - 3400, failed: false }, now), { text: '3초 전 갱신', offline: false });
    assert.equal(freshnessLabel({ okAt: now - 125_000, failed: false }, now).text, '2분 전 갱신');
    assert.deepEqual(freshnessLabel({ okAt: now - 12_000, failed: true }, now), { text: '오프라인 · 12초 전 데이터', offline: true });
    assert.deepEqual(freshnessLabel({ okAt: null, failed: true }, now), { text: '오프라인', offline: true });
});
