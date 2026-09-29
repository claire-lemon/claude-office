import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MEETING_MARK, meetingId, meetingMarker, meetingIdIn, meetingPrompt, GUIDE_VERSION, GUIDE_HEADER, facilitatorGuide, boardItems, normTitle, syncPlan,
} from '../../src/domain/meeting.mjs';
import { NEXT_PROMPT_LIMIT } from '../../src/domain/prompts.mjs';

test('meeting marker: id format, found in a transcript head, other dates kept, absent -> null', () => {
    assert.equal(meetingId('2026-09-29', 1), '2026-09-29-1');
    assert.equal(meetingMarker('2026-09-29-1'), '🏫 데일리 스크럼 #meeting-2026-09-29-1');
    assert.equal(meetingIdIn(`{"type":"user","message":{"content":"${meetingMarker(meetingId('2026-09-29', 12))}\\n오늘 일지"}}`), '2026-09-29-12');
    // the usecase filters by today's date prefix; the domain only reads the id
    assert.equal(meetingIdIn('#meeting-2026-09-28-3'), '2026-09-28-3');
    ['', null, undefined, '#meeting-2026-09-29', '#meeting-2026-9-29-1', '#meeting-2026-09-29-1x', '#todo-abc123'].forEach(t => assert.equal(meetingIdIn(t), null, String(t)));
    assert.ok(MEETING_MARK.test('#meeting-2026-09-29-1'));
});

test('meetingPrompt: marker first line, note path, CLAUDE.md pointer, within the deep-link limit', () => {
    const id = meetingId('2026-09-29', 1);
    const note = '/Users/me/.claude/office/daily/2026-09-29.md';
    const guide = '/Users/me/.claude/office/CLAUDE.md';
    const prompt = meetingPrompt(id, note, guide);
    // guide path first: the app may open a scratch workspace, so CLAUDE.md is read by path, not by cwd
    assert.equal(prompt, `${meetingMarker(id)}\n지침: ${guide}\n오늘 일지: ${note}\n지침 파일을 먼저 읽고 그대로 회의를 시작해줘. 지침과 일지 외의 파일은 읽지 마.`);
    assert.ok(prompt.length <= NEXT_PROMPT_LIMIT);
    assert.equal(meetingIdIn(prompt), id);
});

test('facilitatorGuide v3: version header first, no CLI, the 칠판 list format and the hard rules', () => {
    const guide = facilitatorGuide();
    assert.equal(GUIDE_VERSION, 3);
    assert.equal(GUIDE_HEADER, `<!-- claude-office guide v${GUIDE_VERSION} -->`);
    assert.equal(guide.split('\n')[0], GUIDE_HEADER);
    // the facilitator only talks: its list is the day's todos, the server writes them
    ['bin/office.mjs', 'todo add', 'todo list', '--source', 'node '].forEach(w => assert.ok(!guide.includes(w), w));
    [
        '### 칠판', '`N. <제목> — <폴더 이름>`', '1. 결제 모듈 리팩터링 — api-server\n   1. PG 응답 파싱을 use-case로 옮기기', '7개 이하', '우선순위',
        '## 최근 프로젝트 폴더', '## 칠판 (지금)', '어제 끝낸 일', '못 끝낸 일', '오늘 추천', '조용해도', 'Bash', 'git', '웹', '레포', '볼트', '파일 쓰기',
    ].forEach(w => assert.ok(guide.includes(w), w));
    // the guide's own example parses as the list it describes
    assert.deepEqual(boardItems(guide.slice(guide.indexOf('```markdown'))).map(i => [i.title, i.folder]), [['결제 모듈 리팩터링', 'api-server'], ['문서 커밋·PR', 'knowledge']]);
    assert.ok(!guide.includes('## 결재 보고'));
    assert.ok(guide.split('\n').length <= 90);
});

test('normTitle: trim, collapse spaces, lowercase, trailing . , · dropped', () => {
    assert.equal(normTitle('  결제   모듈 Refactor.  '), '결제 모듈 refactor');
    assert.equal(normTitle('문서 정리 · '), '문서 정리');
    assert.equal(normTitle('a,b.'), 'a,b');
    assert.equal(normTitle(null), '');
});

const REPLY = [
    '### 어제 끝낸 일',
    '1. 결제 분리 완료',
    '',
    '### 칠판',
    '1. 이전 목록 — api',
    '',
    '조정했어요.',
    '',
    '### 칠판',
    '',
    '1. **결제 모듈 리팩터링** — `api-server`',
    '   1. PG 응답 파싱을 use-case로 옮기기',
    '   - 테스트 추가',
    '2. 문서 커밋 — PR 정리 — knowledge',
    '3) 폴더 없는 항목',
    '4. 하이픈 구분 - web  ',
    '',
    '5. 엔 대시 구분 – web',
    '끝.',
    '6. 목록 밖 — web',
].join('\n');

test('boardItems: the last 칠판 section, title / folder on the last dash, details, list end', () => {
    assert.deepEqual(boardItems(REPLY), [
        { title: '결제 모듈 리팩터링', folder: 'api-server', detail: 'PG 응답 파싱을 use-case로 옮기기\n테스트 추가' },
        { title: '문서 커밋 — PR 정리', folder: 'knowledge', detail: '' },
        { title: '폴더 없는 항목', folder: '', detail: '' },
        { title: '하이픈 구분', folder: 'web', detail: '' },
        { title: '엔 대시 구분', folder: 'web', detail: '' },
    ]);
    // ## / #### headings too; another heading ends the list; "1. 없음" is no item
    assert.deepEqual(boardItems('## 칠판\n1. a — x\n### 다음\n2. b — y').map(i => i.title), ['a']);
    assert.deepEqual(boardItems('#### 칠판\n1. a — x').map(i => i.title), ['a']);
    assert.deepEqual(boardItems('### 칠판\n1. 없음'), []);
    // the note's own heading is not the facilitator's list
    assert.deepEqual(boardItems('## 칠판 (지금)\n1. ☐ a — x'), []);
    ['', null, '### 오늘 추천\n1. a — x', '### 칠판\n'].forEach(t => assert.deepEqual(boardItems(t), [], String(t)));
    // capped at 7, the first ones kept
    const many = ['### 칠판', ...Array.from({ length: 9 }, (_, i) => `${i + 1}. 할 일 ${i + 1} — api`)].join('\n');
    assert.deepEqual(boardItems(many).map(i => i.title), Array.from({ length: 7 }, (_, i) => `할 일 ${i + 1}`));
});

const FOLDERS = [
    { path: '/r/api-server', name: 'api-server' },
    { path: '/r/knowledge', name: 'knowledge' },
    { path: '/a/web', name: 'web' },
    { path: '/b/web', name: 'web' },
    { path: '/r/Docs', name: 'Docs' },
];
const MID = '2026-09-29-1';
const todo = (id, title, extra = {}) => ({
    id, title, folder: '/r/api-server', detail: '', status: 'open', manual: null, assigned: [], sessions: [], deletedAt: null, source: 'manual', ...extra,
});
const ours = (id, title, extra = {}) => todo(id, title, { source: 'scrum', meeting: { id: MID, key: normTitle(title) }, ...extra });
const item = (title, folder, detail = '') => ({ title, folder, detail });

test('syncPlan: create in item order, folder by path / name / case-insensitive name, unknown and ambiguous skipped', () => {
    const plan = syncPlan({
        meetingId: MID,
        items: [item('결제 모듈', 'api-server', '메모'), item('문서', '/r/knowledge'), item('웹', 'web'), item('없는 폴더', 'nope'), item('독스', 'docs'), item('폴더 없음', '')],
        todos: [],
        folders: FOLDERS,
    });
    assert.deepEqual(plan, {
        create: [
            { title: '결제 모듈', folder: '/r/api-server', detail: '메모', key: '결제 모듈' },
            { title: '문서', folder: '/r/knowledge', detail: '', key: '문서' },
            { title: '독스', folder: '/r/Docs', detail: '', key: '독스' },
        ],
        update: [],
        remove: [],
        skipped: [
            { title: '웹', folder: 'web', reason: 'ambiguous folder' },
            { title: '없는 폴더', folder: 'nope', reason: 'unknown folder' },
            { title: '폴더 없음', folder: '', reason: 'unknown folder' },
        ],
    });
    // an exact-case name wins over a case-insensitive one
    const both = [{ path: '/x/Api', name: 'Api' }, { path: '/y/api', name: 'api' }];
    assert.deepEqual(syncPlan({ meetingId: MID, items: [item('a', 'api')], todos: [], folders: both }).create.map(c => c.folder), ['/y/api']);
});

test('syncPlan: duplicates of any live todo (manual, earlier meeting, renamed one of ours) and of the list itself are skipped', () => {
    const todos = [
        todo('m1', '결제 모듈  리팩터링.'),
        ours('o1', '고친 제목', { meeting: { id: MID, key: '원래 제목' } }),
        todo('d1', '지운 것', { deletedAt: 1 }),
        todo('p1', '이전 회의 것', { source: 'scrum', meeting: { id: '2026-09-29-0', key: '이전 회의 것' } }),
    ];
    const plan = syncPlan({
        meetingId: MID,
        items: [item('결제 모듈 리팩터링', 'api-server'), item('고친 제목', 'api-server'), item('원래 제목', 'api-server'), item('지운 것', 'api-server'), item('이전 회의 것', 'knowledge'), item('지운 것.', 'knowledge')],
        todos,
        folders: FOLDERS,
    });
    // 지운 것: a deleted manual todo is no duplicate; the list's second 지운 것 is
    assert.deepEqual(plan, { create: [{ title: '지운 것', folder: '/r/api-server', detail: '', key: '지운 것' }], update: [], remove: [], skipped: [] });
});

test('syncPlan: our own item -> only detail / folder updated when different; one the user deleted is left alone', () => {
    const todos = [
        ours('o1', '결제 모듈', { detail: '옛 메모', title: '사용자가 고친 제목' }),
        ours('o2', '문서', { detail: '같은 메모', folder: '/r/api-server' }),
        ours('o3', '그대로', { detail: '메모' }),
        ours('o4', '지워진 것', { deletedAt: 5 }),
        ours('o5', '못 찾는 폴더로', { detail: 'x' }),
    ];
    const plan = syncPlan({
        meetingId: MID,
        items: [item('결제 모듈', 'api-server', '새 메모'), item('문서', 'knowledge', '같은 메모'), item('그대로', 'api-server', ' 메모 '), item('지워진 것', 'api-server'), item('못 찾는 폴더로', 'nope', 'x')],
        todos,
        folders: FOLDERS,
    });
    assert.deepEqual(plan, {
        create: [],
        update: [{ id: 'o1', patch: { detail: '새 메모' } }, { id: 'o2', patch: { folder: '/r/knowledge' } }],
        remove: [],
        skipped: [],
    });
});

test('syncPlan: our open untouched items dropped from the list are removed; started / checked / assigned / linked / others kept', () => {
    const todos = [
        ours('keep', '남는 것'),
        ours('gone', '빠진 것'),
        ours('started', '시작한 것', { status: 'started', sessions: [{ id: 's1' }] }),
        ours('done', '체크한 것', { status: 'done', manual: { state: 'done', at: 1 } }),
        ours('reopened', '체크 해제한 것', { manual: { state: 'open', at: 2 } }),
        ours('assigned', '배정한 것', { assigned: ['s2'] }),
        ours('deleted', '이미 지운 것', { deletedAt: 3 }),
        todo('manual', '손으로 쓴 것'),
        todo('other', '다른 회의 것', { meeting: { id: '2026-09-29-2', key: '다른 회의 것' } }),
    ];
    const plan = syncPlan({ meetingId: MID, items: [item('남는 것', 'api-server')], todos, folders: FOLDERS });
    assert.deepEqual(plan, { create: [], update: [], remove: ['gone'], skipped: [] });
});
