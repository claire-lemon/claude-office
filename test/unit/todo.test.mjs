import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    TODO_MARK, markerLine, todoIdIn, normalizeTodoPatch, todoStatus, visibleToday, isSameLocalDay, toTodoView, linkChanges, mergeLinks, touchedSince,
} from '../../src/domain/todo.mjs';
import { todoPrompt, NEXT_PROMPT_LIMIT } from '../../src/domain/prompts.mjs';

const todo = (manual = null) => ({ title: '결제 모듈', detail: '', folder: '/r/api', createdAt: 1, source: 'manual', manual, deletedAt: null });
const s = (status, lastAt, decidedAt = null, id = `s${lastAt}`) => ({ id, status, lastAt, decidedAt });
const statusOf = (sessions, manual) => todoStatus({ todo: todo(manual), sessions, now: 10_000 });

test('todoStatus: no linked session -> open, or the manual value', () => {
    assert.deepEqual(statusOf([]), { status: 'open', doneAt: null, by: null });
    assert.deepEqual(statusOf([], { state: 'done', at: 50 }), { status: 'done', doneAt: 50, by: 'manual' });
    assert.deepEqual(statusOf([], { state: 'open', at: 50 }), { status: 'open', doneAt: null, by: 'manual' });
});

test('todoStatus: latest session working / pending / hold / unknown / off board -> started', () => {
    ['working', 'review', 'question', 'blocked', 'hold', 'unknown', 'stale', 'something-new'].forEach(status =>
        assert.deepEqual(statusOf([s(status, 100, status === 'hold' ? 90 : null)]), { status: 'started', doneAt: null, by: 'session' }, status));
});

test('todoStatus: confirm or archive -> done at the decision time; undo / restore -> started', () => {
    assert.deepEqual(statusOf([s('done', 100, 200)]), { status: 'done', doneAt: 200, by: 'session' });
    assert.deepEqual(statusOf([s('archived', 100, 300)]), { status: 'done', doneAt: 300, by: 'session' });
    // undo drops the decision: the session is back to its hook status
    assert.deepEqual(statusOf([s('review', 100)]), { status: 'started', doneAt: null, by: 'session' });
    // restore from 보관함 lands in 보류
    assert.deepEqual(statusOf([s('hold', 100, 400)]), { status: 'started', doneAt: null, by: 'session' });
});

test('todoStatus: the newer of the manual check and the session wins', () => {
    // manual newer than the confirm decision
    assert.deepEqual(statusOf([s('done', 100, 200)], { state: 'open', at: 300 }), { status: 'started', doneAt: null, by: 'manual' });
    // manual older than the confirm decision
    assert.deepEqual(statusOf([s('done', 100, 200)], { state: 'open', at: 150 }), { status: 'done', doneAt: 200, by: 'session' });
    // manual done newer than the working session's last activity
    assert.deepEqual(statusOf([s('working', 100)], { state: 'done', at: 150 }), { status: 'done', doneAt: 150, by: 'manual' });
    // the session moved on after the manual check
    assert.deepEqual(statusOf([s('working', 200)], { state: 'done', at: 150 }), { status: 'started', doneAt: null, by: 'session' });
    // unchecking a todo that still has sessions: started, not open
    assert.deepEqual(statusOf([s('review', 100)], { state: 'open', at: 150 }), { status: 'started', doneAt: null, by: 'manual' });
});

test('todoStatus: two sessions -> the most recent one decides, whatever the order', () => {
    const first = s('archived', 100, 150);
    const second = s('working', 200);
    assert.deepEqual(statusOf([first, second]), { status: 'started', doneAt: null, by: 'session' });
    assert.deepEqual(statusOf([second, first]), { status: 'started', doneAt: null, by: 'session' });
    assert.deepEqual(statusOf([s('working', 100), s('done', 200, 250)]), { status: 'done', doneAt: 250, by: 'session' });
});

test('toTodoView: id, project, sessions newest first, latest', () => {
    const v = toTodoView({ id: 'a1b2c3', todo: todo(), sessions: [s('archived', 100, 150), s('working', 200)], now: 1 });
    assert.equal(v.id, 'a1b2c3');
    assert.equal(v.project, 'api');
    assert.equal(v.title, '결제 모듈');
    assert.deepEqual(v.sessions.map(x => x.lastAt), [200, 100]);
    assert.equal(v.latest, v.sessions[0]);
    assert.equal(toTodoView({ id: 'x', todo: todo(), sessions: [], now: 1 }).latest, null);
});

test('visibleToday: done shows only on its local day (midnight boundary)', () => {
    const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();
    const now = at(28, 0, 30);
    assert.equal(visibleToday({ status: 'done', doneAt: at(27, 23, 50) }, now), false);
    assert.equal(visibleToday({ status: 'done', doneAt: at(28, 0, 10) }, now), true);
    assert.equal(visibleToday({ status: 'done', doneAt: at(28, 23, 59) }, at(29, 0, 1)), false);
    assert.equal(visibleToday({ status: 'open', doneAt: null }, now), true);
    assert.equal(visibleToday({ status: 'started', doneAt: null }, now), true);
    assert.equal(isSameLocalDay(at(28, 0), at(28, 23, 59)), true);
    assert.equal(isSameLocalDay(null, now), false);
});

test('TODO_MARK / todoIdIn: finds the 6-char id anywhere in the head, nothing else', () => {
    assert.equal(todoIdIn(`{"type":"user","message":{"content":"${markerLine('a1b2c3', '결제')}"}}\n{"type":"assistant"}`), 'a1b2c3');
    assert.equal(todoIdIn('{"type":"file-history-snapshot"}\n{"type":"user","message":{"content":"본문 중간 #todo-zz9x0y 이어서"}}'), 'zz9x0y');
    assert.equal(todoIdIn('그냥 프롬프트'), null);
    assert.equal(todoIdIn('#todo-abcde 다섯 글자'), null);
    assert.equal(todoIdIn('#todo-abcdefg 일곱 글자'), null);
    assert.equal(todoIdIn('#todo-ABCDEF'), null);
    assert.equal(todoIdIn(''), null);
    assert.equal(todoIdIn(undefined), null);
    assert.equal(markerLine('a1b2c3', '결제 모듈'), '📋 오늘의 할 일 #todo-a1b2c3 · 결제 모듈');
    assert.equal(markerLine('a1b2c3', 'x').match(TODO_MARK)[1], 'a1b2c3');
});

test('normalizeTodoPatch: create cleans title/detail/folder', () => {
    const r = normalizeTodoPatch({ title: '  결제\n모듈\t리팩터링 ', detail: ' 1줄\r\n2줄\u0007끝 ', folder: '/r/api//' }, { create: true });
    assert.deepEqual(r, { ok: true, patch: { title: '결제 모듈 리팩터링', detail: '1줄\n2줄 끝', folder: '/r/api' } });
    assert.equal(normalizeTodoPatch({ title: 'x', folder: '/' }, { create: true }).patch.folder, '/');
    // code-point cuts: Korean/emoji count as one each
    assert.equal([...normalizeTodoPatch({ title: '가'.repeat(200), folder: '/r' }, { create: true }).patch.title].length, 120);
    assert.equal([...normalizeTodoPatch({ title: '😀'.repeat(200), folder: '/r' }, { create: true }).patch.title].length, 120);
    assert.equal([...normalizeTodoPatch({ detail: '나'.repeat(3000) }).patch.detail].length, 2000);
});

test('normalizeTodoPatch: update accepts done / deleted:false', () => {
    assert.deepEqual(normalizeTodoPatch({ done: true }), { ok: true, patch: { done: true } });
    assert.deepEqual(normalizeTodoPatch({ done: false, title: '새 제목' }), { ok: true, patch: { done: false, title: '새 제목' } });
    assert.deepEqual(normalizeTodoPatch({ deleted: false }), { ok: true, patch: { deleted: false } });
    assert.deepEqual(normalizeTodoPatch({ detail: '' }), { ok: true, patch: { detail: '' } });
});

test('normalizeTodoPatch: every error', () => {
    const err = (raw, opts) => normalizeTodoPatch(raw, opts).error;
    const create = { create: true };
    [null, 'x', 1, ['title']].forEach(raw => assert.equal(err(raw, create), 'body must be an object'));
    assert.equal(err({}), 'empty patch');
    assert.equal(err({}, create), 'title required');
    assert.equal(err({ folder: '/r' }, create), 'title required');
    assert.equal(err({ title: ' \n\t ', folder: '/r' }, create), 'title required');
    assert.equal(err({ title: '' }), 'title required');
    assert.equal(err({ title: 'x' }, create), 'folder required');
    assert.equal(err({ title: 'x', folder: '' }, create), 'folder required');
    assert.equal(err({ title: 'x', folder: 'repo/api' }, create), 'folder must be an absolute path');
    assert.equal(err({ folder: '~/repo' }), 'folder must be an absolute path');
    assert.equal(err({ title: 'x', folder: '/r', color: 'red' }, create), 'unknown field: color');
    assert.equal(err(JSON.parse('{"__proto__":"x"}')), 'unknown field: __proto__');
    // switches are update-only
    assert.equal(err({ title: 'x', folder: '/r', done: true }, create), 'unknown field: done');
    assert.equal(err({ title: 123 }), 'title must be a string');
    assert.equal(err({ detail: null }), 'detail must be a string');
    assert.equal(err({ folder: ['/r'] }), 'folder must be a string');
    ['yes', 1, null].forEach(done => assert.equal(err({ done }), 'done must be a boolean'));
    [true, 'false', null].forEach(deleted => assert.equal(err({ deleted }), 'deleted must be false'));
});

test('todoPrompt: marker first, detail, project, previous session only on a retry, closing line', () => {
    const t = { id: 'a1b2c3', title: '결제 모듈 리팩터링', detail: 'PG 응답 파싱을 use-case로', folder: '/r/api' };
    assert.equal(
        todoPrompt(t, null),
        ['📋 오늘의 할 일 #todo-a1b2c3 · 결제 모듈 리팩터링', 'PG 응답 파싱을 use-case로', '- 프로젝트: /r/api', '끝나면 결재 보고로 마무리해줘.'].join('\n'),
    );
    assert.equal(todoPrompt({ ...t, detail: '' }, null).split('\n')[1], '- 프로젝트: /r/api');
    const latest = { title: '1차', branch: 'feat/x', prs: [{ url: 'https://github.com/a/b/pull/1' }], report: { '한 줄 요약': '1. 파싱 분리\n완료' } };
    const lines = todoPrompt(t, latest).split('\n');
    assert.equal(lines[3], '- 이전 세션 "1차": 브랜치 feat/x, PR https://github.com/a/b/pull/1, 한 줄 요약: 1. 파싱 분리 완료');
    assert.equal(lines.at(-1), '끝나면 결재 보고로 마무리해줘.');
    // a lean (off-board) session has no branch/PR/report: just its title
    assert.equal(todoPrompt(t, { title: '예전 세션' }).split('\n')[3], '- 이전 세션 "예전 세션"');
});

test('todoPrompt: over the limit, detail is cut and the marker line never is', () => {
    const t = { id: 'a1b2c3', title: '가'.repeat(120), detail: '나'.repeat(5000), folder: '/r/api' };
    const p = todoPrompt(t, { title: 't', branch: 'b', report: { '한 줄 요약': '요약' } });
    assert.equal(p.length, NEXT_PROMPT_LIMIT);
    assert.equal(p.split('\n')[0], markerLine('a1b2c3', t.title));
    assert.match(p, /- 프로젝트: \/r\/api\n- 이전 세션 "t": 브랜치 b, 한 줄 요약: 요약\n끝나면 결재 보고로 마무리해줘\.$/);
    // an emoji is never split at the cut
    const emoji = todoPrompt({ ...t, detail: '😀'.repeat(3000) }, null);
    assert.ok(emoji.length <= NEXT_PROMPT_LIMIT);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji));
});

// A live link as linkIndex builds it: board views carry branch/prs/report too.
const live = (todoId, id, status, lastAt, extra = {}) => ({ todoId, view: { id, title: `t-${id}`, animal: 'cat', status, column: 'working', lastAt, decidedAt: null, ...extra } });
const record = (todoId, status, lastAt, seenAt, extra = {}) => ({ todoId, title: 't-s1', animal: 'cat', status, decidedAt: null, lastAt, seenAt, ...extra });

test('linkChanges: new links and todo / title / status / decision changes only; lastAt alone writes nothing', () => {
    assert.deepEqual(linkChanges({}, [live('a1b2c3', 's1', 'working', 100, { branch: 'feat/x', prs: [], report: null })], 500), { s1: record('a1b2c3', 'working', 100, 500) });
    const stored = { s1: record('a1b2c3', 'working', 100, 50) };
    assert.deepEqual(linkChanges(stored, [live('a1b2c3', 's1', 'working', 900)], 500), {});
    // status moved: rewritten with the current lastAt, the first-seen time kept
    assert.deepEqual(linkChanges(stored, [live('a1b2c3', 's1', 'review', 900)], 500), { s1: record('a1b2c3', 'review', 900, 50) });
    assert.deepEqual(linkChanges(stored, [live('a1b2c3', 's1', 'done', 900, { decidedAt: 950 })], 500), { s1: record('a1b2c3', 'done', 900, 50, { decidedAt: 950 }) });
    assert.deepEqual(Object.keys(linkChanges(stored, [live('zz9x0y', 's1', 'working', 100)], 500)), ['s1']);
    assert.deepEqual(Object.keys(linkChanges(stored, [live('a1b2c3', 's1', 'working', 100, { title: '새 이름' })], 500)), ['s1']);
    // a stored link that is not live now is left alone (mergeLinks shows it)
    assert.deepEqual(linkChanges(stored, [], 500), {});
});

test('mergeLinks: live wins with all its fields; vanished done/archived stay, the rest read stale', () => {
    const stored = {
        s1: record('a1b2c3', 'working', 100, 50),
        s2: record('a1b2c3', 'archived', 80, 40, { title: '1차', decidedAt: 90 }),
        s3: record('zz9x0y', 'done', 70, 30, { title: '끝', decidedAt: 75 }),
        s4: record('zz9x0y', 'working', 60, 20, { title: '중단' }),
    };
    const liveOne = live('a1b2c3', 's1', 'review', 200, { column: 'pending', branch: 'feat/x', prs: [{ url: 'u' }], report: { '한 줄 요약': '1. x' } });
    const merged = mergeLinks(stored, [liveOne]);
    assert.deepEqual([...merged.keys()].sort(), ['a1b2c3', 'zz9x0y']);
    const [first, second] = merged.get('a1b2c3');
    assert.equal(first, liveOne.view);
    assert.deepEqual(second, { id: 's2', title: '1차', animal: 'cat', status: 'archived', column: null, lastAt: 80, decidedAt: 90 });
    assert.deepEqual(merged.get('zz9x0y'), [
        { id: 's3', title: '끝', animal: 'cat', status: 'done', column: 'done', lastAt: 70, decidedAt: 75 },
        { id: 's4', title: '중단', animal: 'cat', status: 'stale', column: null, lastAt: 60, decidedAt: null },
    ]);
    assert.deepEqual(mergeLinks({}, []), new Map());
});

test('touchedSince: any of created / done / deleted / manual check / a session at or after since', () => {
    const base = { createdAt: 10, doneAt: null, deletedAt: null, manual: null, sessions: [] };
    assert.equal(touchedSince(base, 100), false);
    assert.equal(touchedSince({ ...base, createdAt: 100 }, 100), true);
    assert.equal(touchedSince({ ...base, doneAt: 150 }, 100), true);
    assert.equal(touchedSince({ ...base, deletedAt: 150 }, 100), true);
    assert.equal(touchedSince({ ...base, manual: { state: 'open', at: 150 } }, 100), true);
    assert.equal(touchedSince({ ...base, sessions: [{ lastAt: 20 }, { lastAt: 150 }] }, 100), true);
    assert.equal(touchedSince({ ...base, doneAt: 50, deletedAt: 60, manual: { state: 'done', at: 50 }, sessions: [{ lastAt: 99 }] }, 100), false);
});
