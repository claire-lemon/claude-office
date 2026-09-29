import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor } from '../../public/js/panel/actions.js';

const task = title => ({ title, detail: '' });
// Layout assertions compare id/label only; hints are checked in their own test below.
const bare = a => a && { id: a.id, label: a.label, ...(a.kind ? { kind: a.kind } : {}) };

// Row 2 (extra): no separator entries, archive last and the only danger button.
const endsWithArchive = extra => {
  const last = extra[extra.length - 1];
  assert.equal(last.id, 'archive');
  assert.equal(last.kind, 'danger');
  assert.ok(extra.every(a => a.kind !== 'separator' && a.id !== 'separator'));
  assert.deepEqual(extra.filter(a => a.kind === 'danger').map(a => a.id), ['archive']);
};

test('결재 대기 (review/question/blocked, no next tasks): confirm primary, open secondary, summary/hold/archive extra', () => {
  ['review', 'question', 'blocked'].forEach(status => {
    const { primary, secondary, extra } = actionsFor({ status, link: 'claude://x', nextTasks: [] });
    assert.deepEqual(bare(primary), { id: 'confirm', label: '컨펌 · 커밋·PR' });
    assert.deepEqual(bare(secondary), { id: 'open', label: '채팅방 열기' });
    assert.deepEqual(extra.map(a => a.id), ['summary', 'hold', 'archive']);
    endsWithArchive(extra);
  });
});

test('결재 대기 + 다음 작업 있음 (review only): split primary OK·1번, options for 2번/3번 with titles, confirm moves into extra', () => {
  const { primary, secondary, extra } = actionsFor({
    status: 'review',
    link: 'claude://x',
    nextTasks: [task('타입 배포'), task('프론트 반영'), task('캐시 적용')],
  });
  assert.equal(primary.id, 'next:0');
  assert.equal(primary.label, 'OK · 1번 진행');
  assert.equal(primary.kind, 'split');
  assert.deepEqual(primary.options.map(bare), [
    { id: 'next:1', label: '2번 진행 · 프론트 반영' },
    { id: 'next:2', label: '3번 진행 · 캐시 적용' },
  ]);
  assert.deepEqual(bare(secondary), { id: 'open', label: '채팅방 열기' });
  assert.deepEqual(extra.map(a => a.id), ['confirm', 'summary', 'hold', 'archive']);
  endsWithArchive(extra);
});

test('결재 대기 + 다음 작업: question/blocked never get the split primary even with next tasks', () => {
  ['question', 'blocked'].forEach(status => {
    const { primary, extra } = actionsFor({ status, link: null, nextTasks: [task('a'), task('b')] });
    assert.equal(primary.id, 'confirm');
    assert.equal(primary.kind, undefined);
    assert.equal(extra[0].id, 'summary'); // confirm stays primary, not pushed into extra
  });
});

test('다음 작업 1개: split primary with no options', () => {
  const { primary } = actionsFor({ status: 'review', link: null, nextTasks: [task('오직 하나')] });
  assert.equal(primary.id, 'next:0');
  assert.deepEqual(primary.options.map(bare), []);
});

test('다음 작업 3개 초과: capped at 3, extra tasks never appear as options', () => {
  const { primary } = actionsFor({
    status: 'review',
    link: null,
    nextTasks: [task('1'), task('2'), task('3'), task('4'), task('5')],
  });
  assert.deepEqual(primary.options.map(o => o.id), ['next:1', 'next:2']);
  assert.deepEqual(primary.options.map(o => o.label), ['2번 진행 · 2', '3번 진행 · 3']);
});

test('작업 중: no primary, hold/archive extra, no summary', () => {
  const { primary, secondary, extra } = actionsFor({ status: 'working', link: 'claude://x', nextTasks: [] });
  assert.equal(primary, null);
  assert.deepEqual(bare(secondary), { id: 'open', label: '채팅방 열기' });
  assert.deepEqual(extra.map(a => a.id), ['hold', 'archive']);
  endsWithArchive(extra);
});

test('보류: 보류 해제 primary, summary/archive extra', () => {
  const { primary, extra } = actionsFor({ status: 'hold', link: 'claude://x', nextTasks: [] });
  assert.deepEqual(bare(primary), { id: 'undo', label: '보류 해제' });
  assert.deepEqual(extra.map(a => a.id), ['summary', 'archive']);
  endsWithArchive(extra);
});

test('완료: no primary, 컨펌 취소/archive extra', () => {
  const { primary, extra } = actionsFor({ status: 'done', link: 'claude://x', nextTasks: [] });
  assert.equal(primary, null);
  assert.deepEqual(extra.map(a => a.id), ['undo', 'archive']);
  assert.equal(extra[0].label, '컨펌 취소');
  endsWithArchive(extra);
});

test('unknown status behaves like 작업 중', () => {
  const unknown = actionsFor({ status: 'unknown', link: 'claude://x', nextTasks: [] });
  const working = actionsFor({ status: 'working', link: 'claude://x', nextTasks: [] });
  assert.deepEqual(unknown, working);
});

test('link이 없으면 secondary(채팅방 열기)가 빠진다', () => {
  assert.equal(actionsFor({ status: 'review', link: null, nextTasks: [] }).secondary, null);
  assert.equal(actionsFor({ status: 'working', link: undefined, nextTasks: [] }).secondary, null);
  assert.equal(actionsFor({ status: 'done', nextTasks: [] }).secondary, null);
});

test('every button carries a hint; OK says it completes this session and opens a new one, confirm says paste+Enter is manual', () => {
  const statuses = ['review', 'question', 'blocked', 'working', 'hold', 'done'];
  const all = statuses.flatMap(status => {
    const { primary, secondary, extra } = actionsFor({ status, link: 'claude://x', nextTasks: [task('a'), task('b')] });
    return [primary, ...(primary?.options || []), secondary, ...extra].filter(Boolean);
  });
  all.forEach(a => assert.ok(a.hint, a.id));
  const ok = actionsFor({ status: 'review', link: null, nextTasks: [task('a'), task('b')] }).primary;
  assert.match(ok.hint, /완료.*새 세션 입력창/);
  assert.match(ok.options[0].hint, /2번 작업/);
  const confirm = actionsFor({ status: 'question', link: null, nextTasks: [] }).primary;
  assert.match(confirm.hint, /클립보드.*채팅방.*Enter는 직접/);
});
