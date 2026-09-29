#!/usr/bin/env node
// Fake office for demos/E2E. Writes ONLY under OFFICE_HOME (refuses the real home).
// OFFICE_HOME=/tmp/fake node scripts/simulate.mjs [--once]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markerLine } from '../src/domain/todo.mjs';
import { meetingId, meetingPrompt } from '../src/domain/meeting.mjs';
import { localDate } from '../src/domain/daily-note.mjs';

const HOME = process.env.OFFICE_HOME;
if (!HOME || path.resolve(HOME) === os.homedir()) {
    console.error('set OFFICE_HOME to a scratch dir');
    process.exit(1);
}
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '../hooks/report.mjs');
const APP = path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/u/u');
const TITLES = [
    '회의록 정리', '인프라 구조 정리', '텔레그램 LLM 연동', '주간 문서 자동화', '티스토리 블로그 작성',
    '프로필 뷰 필드 확장', 'JWT 토큰 갱신', 'ECS 동시 배포 조사', '타입 패키지 버전 전파', '채팅 알림 버그',
];
const REPORT = `작업 끝났습니다.

## 결재 보고
### 한 줄 요약
1. 뷰에 \`workspace$\` 요약 객체 추가 완료
### 리뷰 필요
1. \`src/modules/profile/views.ts:42\` 노출 필드 범위 확인 필요
   1. id/name/stereo 외 필드 포함 여부
2. \`src/lib/profile/use-case.ts:88\` N+1 조회 가능성 확인 필요
### 리스크 / 배포 의존성
1. my-types 선배포 필요
   1. 타입 배포 → API 배포 순서
### 테스트 방법
1. \`http :8888/profile\` 호출
   1. \`workspace$\` 필드 존재 확인
2. \`npm test\` 실행
   1. 42개 통과 확인
### 다음 작업
1. my-types 패키지 버전 올려 배포
   1. API가 새 타입을 쓰려면 선배포 필요
2. 프론트(my-web)에서 \`workspace$\` 표시
3. use-case N+1 조회 캐시 적용`;

const hook = (id, event, cwd, transcript, message) =>
    execFileSync('node', [HOOK], {
        env: { ...process.env, OFFICE_HOME: HOME },
        input: JSON.stringify({ session_id: id, hook_event_name: event, cwd, transcript_path: transcript, message }),
    });

const say = (transcript, text) =>
    fs.appendFileSync(
        transcript,
        `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`,
    );

const repo = path.join(HOME, 'repo');
if (!fs.existsSync(repo)) {
    fs.mkdirSync(repo, { recursive: true });
    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'views.ts'), 'export const a = 1;\n');
    g('add', '.');
    g('-c', 'user.email=o@o', '-c', 'user.name=o', 'commit', '-qm', 'init');
    g('checkout', '-qb', 'feat/x');
    fs.writeFileSync(path.join(repo, 'views.ts'), 'export const a = 1;\nexport const workspace$ = { id, name };\n');
    fs.writeFileSync(path.join(repo, 'new-file.md'), 'untracked\n');
}

const repoDir = n => {
    const dir = path.join(HOME, 'repos', ['api-server', 'web-app', 'infra'][n]);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

// 오늘의 할 일: one open, one linked to local_3 through the marker, one checked off by hand today.
const LINKED_TODO = 'demo02';
const TODOS = path.join(HOME, '.claude/office/todos.json');
if (!fs.existsSync(TODOS)) {
    const now = Date.now();
    const todo = (title, folder, createdAt, manual = null) => ({ title, detail: '', folder, createdAt, source: 'manual', manual, deletedAt: null });
    fs.mkdirSync(path.dirname(TODOS), { recursive: true });
    fs.writeFileSync(
        TODOS,
        JSON.stringify({
            demo01: { ...todo('결제 모듈 리팩터링', repoDir(0), now - 3000), detail: 'PG 응답 파싱을 use-case로 옮기기' },
            [LINKED_TODO]: todo(TITLES[3], repoDir(0), now - 2000),
            demo03: todo('주간 회의록 공유', repoDir(1), now - 1000, { state: 'done', at: now }),
        }),
    );
}

const sessions = TITLES.map((title, i) => {
    const cli = `cli-${i}`;
    const cwd = i === 0 ? repo : path.join(HOME, 'work', `w${i}`);
    const transcript = path.join(HOME, '.claude/projects/p', `${cli}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    // local_3 was started from a 칠판 todo: its first prompt line carries the marker (must be the file's top line).
    if (i === 3 && !fs.existsSync(transcript)) {
        const content = markerLine(LINKED_TODO, title);
        fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
    }
    fs.mkdirSync(APP, { recursive: true });
    fs.writeFileSync(
        path.join(APP, `local_${i}.json`),
        JSON.stringify({
            sessionId: `local_${i}`, cliSessionId: cli, title, cwd, originCwd: i === 0 ? repo : repoDir(i % 3),
            worktreePath: i === 0 ? repo : null, sourceBranch: 'main', branch: `feat/s${i}`,
            prs: i === 0 ? [{ number: 490, state: 'OPEN', url: 'https://github.com/x/y/pull/490' }] : [],
            completedTurns: 3 + i, lastActivityAt: Date.now(), isArchived: false,
        }),
    );
    return { cli, cwd, transcript };
});

// 회의실: today's facilitator (first prompt = the meeting marker) waiting on the user, plus today's 일지.
// Demo mode only: --once is the office test's fixture, which counts exactly 10 sessions.
const MEETING_MESSAGE = `어제 기록 정리했어요.

### 어제 끝낸 일
1. 뷰에 \`workspace$\` 요약 객체 추가 완료
2. 주간 회의록 공유 완료

### 못 끝낸 일
1. 주간 문서 자동화
   1. 오늘 그대로 이어갈까요?
2. 채팅 알림 버그
   1. 원인 조사 중, 이어갈까요?

### 오늘 추천
1. 결제 모듈 리팩터링
   1. 어제 칠판에 남은 항목
2. my-types 패키지 버전 올려 배포
   1. API가 새 타입을 쓰려면 선배포 필요

오늘 할 일로 확정할 항목을 골라주세요.`;
const seedMeeting = async () => {
    const officeDir = path.join(HOME, '.claude/office');
    const today = localDate(Date.now());
    const cli = 'cli-10';
    const transcript = path.join(HOME, '.claude/projects/p', `${cli}.jsonl`);
    if (!fs.existsSync(transcript)) {
        const content = meetingPrompt(meetingId(today, 1), path.join(officeDir, 'daily', `${today}.md`));
        fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
        say(transcript, MEETING_MESSAGE);
    }
    fs.writeFileSync(
        path.join(APP, 'local_10.json'),
        JSON.stringify({
            sessionId: 'local_10', cliSessionId: cli, title: '데일리 스크럼 진행자', cwd: officeDir, originCwd: officeDir,
            worktreePath: null, prs: [], completedTurns: 1, createdAt: Date.now() - 5 * 60_000, lastActivityAt: Date.now(), isArchived: false,
        }),
    );
    hook(cli, 'Stop', officeDir, transcript);
    // config reads OFFICE_HOME at import time; it is set (checked above), so this writes only under it.
    const { refreshNote } = await import('../src/usecases/meeting.mjs');
    refreshNote();
};

// 연결 기록: an archived first try of the linked todo (so it has 2 sessions), a todo finished yesterday through an
// archived session and one deleted yesterday (보관함 "지난 할 일", the note's 할 일 기록). No hook state: a hook
// event would be newer than the archive decision and bring the session back.
const seedHistory = async () => {
    const { transcriptPathFor } = await import('../src/sources/transcripts.mjs');
    const officeDir = path.join(HOME, '.claude/office');
    const d = new Date();
    const yesterday = (h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, m).getTime();
    const past = [
        { n: 11, title: `${TITLES[3]} 1차`, todoId: LINKED_TODO, folder: repoDir(0), lastAt: yesterday(10, 40), archivedAt: yesterday(11, 2) },
        { n: 12, title: '배포 스크립트 정리', todoId: 'demo04', folder: repoDir(2), lastAt: yesterday(18, 0), archivedAt: yesterday(18, 20) },
    ];
    const decisionsFile = path.join(officeDir, 'decisions.json');
    const decisions = fs.existsSync(decisionsFile) ? JSON.parse(fs.readFileSync(decisionsFile, 'utf8')) : {};
    past.forEach(({ n, title, todoId, folder, lastAt, archivedAt }) => {
        const cli = `cli-${n}`;
        const cwd = path.join(HOME, 'work', `w${n}`);
        const transcript = transcriptPathFor(cwd, cli);
        fs.mkdirSync(path.dirname(transcript), { recursive: true });
        fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: markerLine(todoId, title) } })}\n`);
        fs.writeFileSync(
            path.join(APP, `local_${n}.json`),
            JSON.stringify({ sessionId: `local_${n}`, cliSessionId: cli, title, cwd, originCwd: folder, worktreePath: null, prs: [], completedTurns: 2, lastActivityAt: lastAt, isArchived: false }),
        );
        decisions[`local_${n}`] = { kind: 'archive', at: archivedAt, title, summary: '', lastAt };
    });
    fs.writeFileSync(decisionsFile, JSON.stringify(decisions));
    const todo = (title, folder, extra) => ({ title, detail: '', folder, createdAt: yesterday(9), source: 'manual', manual: null, deletedAt: null, ...extra });
    const stored = JSON.parse(fs.readFileSync(TODOS, 'utf8'));
    fs.writeFileSync(
        TODOS,
        JSON.stringify({
            ...stored,
            // 세션 배정: local_1 (no marker) was started from the app and put on demo01 by hand.
            ...(stored.demo01 ? { demo01: { ...stored.demo01, assigned: ['local_1'] } } : {}),
            demo04: todo('배포 스크립트 정리', repoDir(2)),
            demo05: todo('로그 수집기 교체', repoDir(2), { deletedAt: yesterday(15) }),
        }),
    );
};

const EVENTS = ['UserPromptSubmit', 'Stop-report', 'Notification', 'Stop-question', 'UserPromptSubmit'];
const tick = n =>
    sessions.forEach((s, i) => {
        const kind = EVENTS[(i + n) % EVENTS.length];
        if (kind === 'Stop-report') say(s.transcript, REPORT);
        if (kind === 'Stop-question') say(s.transcript, '브랜치를 main 기준으로 만들까요, develop 기준으로 만들까요?');
        if (kind === 'Notification') hook(s.cli, 'UserPromptSubmit', s.cwd, s.transcript);
        hook(s.cli, kind.split('-')[0], s.cwd, s.transcript, kind === 'Notification' ? 'Claude needs your permission to use Bash' : undefined);
    });

tick(0);
if (!process.argv.includes('--once')) {
    await seedHistory();
    await seedMeeting();
    const loop = n => setTimeout(() => (tick(n), loop(n + 1)), 8000);
    loop(1);
    console.log(`simulating 10 sessions under ${HOME} (every 8s)`);
}
