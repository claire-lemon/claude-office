import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor } from '../../public/js/panel/actions.js';

const task = title => ({ title, detail: '' });

const endsWithArchive = overflow => {
  const last = overflow[overflow.length - 1];
  const sep = overflow[overflow.length - 2];
  assert.equal(last.id, 'archive');
  assert.equal(last.kind, 'danger');
  assert.equal(sep.kind, 'separator');
};

test('결재 대기 (review/question/blocked, no next tasks): confirm primary, open secondary, summary/hold/archive overflow', () => {
  ['review', 'question', 'blocked'].forEach(status => {
    const { primary, secondary, overflow } = actionsFor({ status, link: 'claude://x', nextTasks: [] });
    assert.deepEqual(primary, { id: 'confirm', label: '컨펌 · 커밋·PR' });
    assert.deepEqual(secondary, { id: 'open', label: '채팅방 열기' });
    assert.deepEqual(overflow.map(a => a.id), ['summary', 'hold', 'separator', 'archive']);
    endsWithArchive(overflow);
  });
});

test('결재 대기 + 다음 작업 있음 (review only): split primary OK·1번, options for 2번/3번 with titles, confirm moves into overflow', () => {
  const { primary, secondary, overflow } = actionsFor({
    status: 'review',
    link: 'claude://x',
    nextTasks: [task('타입 배포'), task('프론트 반영'), task('캐시 적용')],
  });
  assert.equal(primary.id, 'next:0');
  assert.equal(primary.label, 'OK · 1번 진행');
  assert.equal(primary.kind, 'split');
  assert.deepEqual(primary.options, [
    { id: 'next:1', label: '2번 진행 · 프론트 반영' },
    { id: 'next:2', label: '3번 진행 · 캐시 적용' },
  ]);
  assert.deepEqual(secondary, { id: 'open', label: '채팅방 열기' });
  assert.deepEqual(overflow.map(a => a.id), ['confirm', 'summary', 'hold', 'separator', 'archive']);
  endsWithArchive(overflow);
});

test('결재 대기 + 다음 작업: question/blocked never get the split primary even with next tasks', () => {
  ['question', 'blocked'].forEach(status => {
    const { primary, overflow } = actionsFor({ status, link: null, nextTasks: [task('a'), task('b')] });
    assert.equal(primary.id, 'confirm');
    assert.equal(primary.kind, undefined);
    assert.equal(overflow[0].id, 'summary'); // confirm stays primary, not pushed into overflow
  });
});

test('다음 작업 1개: split primary with no options', () => {
  const { primary } = actionsFor({ status: 'review', link: null, nextTasks: [task('오직 하나')] });
  assert.equal(primary.id, 'next:0');
  assert.deepEqual(primary.options, []);
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

test('작업 중: no primary, hold/archive overflow, no summary', () => {
  const { primary, secondary, overflow } = actionsFor({ status: 'working', link: 'claude://x', nextTasks: [] });
  assert.equal(primary, null);
  assert.deepEqual(secondary, { id: 'open', label: '채팅방 열기' });
  assert.deepEqual(overflow.map(a => a.id), ['hold', 'separator', 'archive']);
  endsWithArchive(overflow);
});

test('보류: 보류 해제 primary, summary/archive overflow', () => {
  const { primary, overflow } = actionsFor({ status: 'hold', link: 'claude://x', nextTasks: [] });
  assert.deepEqual(primary, { id: 'undo', label: '보류 해제' });
  assert.deepEqual(overflow.map(a => a.id), ['summary', 'separator', 'archive']);
  endsWithArchive(overflow);
});

test('완료: no primary, 컨펌 취소/archive overflow', () => {
  const { primary, overflow } = actionsFor({ status: 'done', link: 'claude://x', nextTasks: [] });
  assert.equal(primary, null);
  assert.deepEqual(overflow.map(a => a.id), ['undo', 'separator', 'archive']);
  assert.equal(overflow[0].label, '컨펌 취소');
  endsWithArchive(overflow);
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
