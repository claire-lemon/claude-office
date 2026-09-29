import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAppSummary, toSessionView } from '../../src/domain/session-view.mjs';
import { reportSource } from '../../public/js/panel/report-tab.js';

const POST_TURN = { status_category: 'completed', status_detail: '뷰 필드 추가 완료', needs_action: '', summarizes_uuid: 'u1' };

test('toAppSummary: maps the app postTurnSummary, null for missing or unexpected shapes', () => {
    assert.deepEqual(toAppSummary(POST_TURN), { category: 'completed', detail: '뷰 필드 추가 완료', needsAction: '' });
    assert.deepEqual(toAppSummary({ status_detail: '권한 대기', needs_action: 'Bash 허용' }), { category: '', detail: '권한 대기', needsAction: 'Bash 허용' });
    [undefined, null, 'text', {}, { status_detail: '  ' }, { status_detail: 3 }].forEach(p => assert.equal(toAppSummary(p), null));
});

test('toSessionView: appSummary is an added field; existing fields unchanged', () => {
    const base = { cli: 'c1', state: { event: 'Stop', at: 1 }, lastAt: 1, cwd: '/w/x', transcript: '', lastText: 'hi', report: null, id: 'c1', summary: null, status: 'question', baseStatus: 'question', gi: {}, diffStat: null, home: '/h' };
    const v = toSessionView({ ...base, app: { postTurnSummary: POST_TURN } });
    assert.equal(v.appSummary.detail, '뷰 필드 추가 완료');
    assert.equal(v.status, 'question'); // the 보고 없음 relabel keeps the status id
    assert.equal(v.preview, 'hi');
    assert.equal(toSessionView({ ...base, app: null }).appSummary, null);
});

test('reportSource: report -> summary -> appSummary -> last reply', () => {
    const all = { report: { a: '1' }, summary: 's', appSummary: { detail: 'd' }, lastMessage: 'm' };
    assert.equal(reportSource(all), 'report');
    assert.equal(reportSource({ ...all, report: null }), 'summary');
    assert.equal(reportSource({ ...all, report: null, summary: null }), 'appSummary');
    assert.equal(reportSource({ lastMessage: 'm', appSummary: null }), 'lastMessage');
    assert.equal(reportSource({}), null);
});
