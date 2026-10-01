#!/usr/bin/env node
// Fake office for demos/E2E. Writes ONLY under OFFICE_HOME (refuses the real home).
// OFFICE_HOME=/tmp/fake node scripts/simulate.mjs [--once]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localDate, narrativeSection, replaceNarrative, startOfYesterday } from '../src/domain/daily-note.mjs';

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

const sessions = TITLES.map((title, i) => {
    const cli = `cli-${i}`;
    const cwd = i === 0 ? repo : path.join(HOME, 'work', `w${i}`);
    const transcript = path.join(HOME, '.claude/projects/p', `${cli}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.mkdirSync(APP, { recursive: true });
    fs.writeFileSync(
        path.join(APP, `local_${i}.json`),
        JSON.stringify({
            sessionId: `local_${i}`, cliSessionId: cli, title, cwd, originCwd: i === 0 ? repo : repoDir(i % 3),
            worktreePath: i === 0 ? repo : null, sourceBranch: 'main', branch: `feat/s${i}`,
            prs: i === 0 ? [{ number: 490, state: 'OPEN', url: 'https://github.com/x/y/pull/490' }] : [],
            completedTurns: 3 + i, lastActivityAt: Date.now(), isArchived: false,
            // The app's own turn summary: odd desks have one, so a 보고 없음 card shows 앱 요약 in its panel.
            ...(i % 2 ? { postTurnSummary: { status_category: 'blocked', status_detail: `${title}: 브랜치 기준을 정하지 못해 멈춤`, needs_action: 'main / develop 중 기준 브랜치 답변 필요', summarizes_uuid: 'demo' } } : {}),
        }),
    );
    return { cli, cwd, transcript };
});

// 업무일지: two sessions archived yesterday (so 어제 세션 has finished work too), then today's note with its auto
// block and a sample AI 서술 (the demo never calls the model). No hook state for the archived ones: a hook event
// would be newer than the archive decision and bring the session back. Demo mode only: --once is the office
// test's fixture, which counts exactly 10 sessions.
const DEMO_NARRATIVE = `1. **web-app 인프라 구조**: 결제 모듈을 나누기 전에 인프라 구조부터 정리했다. 모듈 경계를 문서로 먼저 맞추고 \`feat/s1\`에서 뷰에 \`workspace$\` 요약 객체를 붙여 결재 대기에 올렸다.
2. **배포 스크립트**: 배포 스크립트를 한 파일로 모아 정리했고, 저녁에 보관함으로 옮겼다.
3. **남은 것**
   1. 채팅 알림 버그 원인 조사 중
   2. 타입 패키지 버전 전파는 기준 브랜치 답변 대기`;
const seedJournal = async () => {
    const { transcriptPathFor } = await import('../src/sources/transcripts.mjs');
    const officeDir = path.join(HOME, '.claude/office');
    const d = new Date();
    const yesterday = (h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, m).getTime();
    const past = [
        { n: 11, title: '인프라 구조 정리 1차', folder: repoDir(0), lastAt: yesterday(10, 40), archivedAt: yesterday(11, 2) },
        { n: 12, title: '배포 스크립트 정리', folder: repoDir(2), lastAt: yesterday(18, 0), archivedAt: yesterday(18, 20) },
    ];
    const decisionsFile = path.join(officeDir, 'decisions.json');
    const decisions = fs.existsSync(decisionsFile) ? JSON.parse(fs.readFileSync(decisionsFile, 'utf8')) : {};
    past.forEach(({ n, title, folder, lastAt, archivedAt }) => {
        const cli = `cli-${n}`;
        const cwd = path.join(HOME, 'work', `w${n}`);
        const transcript = transcriptPathFor(cwd, cli);
        fs.mkdirSync(path.dirname(transcript), { recursive: true });
        fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: title } })}\n`);
        fs.writeFileSync(
            path.join(APP, `local_${n}.json`),
            JSON.stringify({ sessionId: `local_${n}`, cliSessionId: cli, title, cwd, originCwd: folder, worktreePath: null, prs: [], completedTurns: 2, lastActivityAt: lastAt, isArchived: false }),
        );
        decisions[`local_${n}`] = { kind: 'archive', at: archivedAt, title, summary: '', lastAt };
    });
    fs.mkdirSync(officeDir, { recursive: true });
    fs.writeFileSync(decisionsFile, JSON.stringify(decisions));
    // config reads OFFICE_HOME at import time; it is set (checked above), so this writes only under it.
    const { refreshNote } = await import('../src/usecases/narrate.mjs');
    const notes = await import('../src/sources/daily-notes.mjs');
    refreshNote();
    const now = Date.now();
    const date = localDate(now);
    const section = narrativeSection({ at: now, since: startOfYesterday(now), count: past.length + TITLES.length, body: DEMO_NARRATIVE });
    notes.write(date, replaceNarrative(notes.read(date), section, date));
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
    await seedJournal();
    const loop = n => setTimeout(() => (tick(n), loop(n + 1)), 8000);
    loop(1);
    console.log(`simulating 10 sessions under ${HOME} (every 8s)`);
}
