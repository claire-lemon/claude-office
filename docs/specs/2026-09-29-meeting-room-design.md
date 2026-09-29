# 설계: 회의실 (daily scrum, 2/4)

- 작성일: 2026-09-29
- 상태: 구현 완료 (2026-09-29, 백엔드 `2ef66d0` + 프론트·문서 후속 커밋)
- 전체 그림: `2026-09-28-todo-blackboard-design.md` 머리의 4조각 표. 이 문서는 2조각이다. 3조각(업무일지 자동 생성)은 §4의 일지 파일 위에 얹는다.
- 사용자 결정: 진행자는 **진짜 Claude Code 세션**(C안), 읽는 것은 **오늘 일지 + 사용자 대화뿐**(레포·볼트 조사 금지), 종료는 **회의 끝 버튼**.

## 1. 흐름

```
[🏫 회의실] 버튼 ─▶ 화면 전환 ─▶ [회의 시작] ─▶ 서버: 오늘 일지 생성/갱신 ─▶ 진행자 세션 딥링크(사용자 Enter)
                                                   │
     앱 채팅창에서 사용자 ⇄ 진행자 대화 ◀───────────┘  진행자: 일지 읽기 → 끝낸 일/못 끝낸 일/추천 제시 → 결정된 것을 CLI로 칠판에 기록
                                                   │
     회의실 화면: 진행자 최근 메시지 + 실시간 칠판 ◀── 2초 폴링
                                                   │
[회의 끝] ─▶ 서버: 진행자 세션 아카이브 + 일지 `## 회의 n` 섹션 기록 ─▶ 사무실로 복귀
```

## 2. 진행자 세션

1. 실행 폴더 `~/.claude/office`(`OFFICE_DIR`). git 레포가 아니라 결재함에서 브랜치·diff는 추적 불가로 뜬다(진행자는 코드를 만지지 않는다).
2. 지침은 `~/.claude/office/CLAUDE.md`(`GUIDE_FILE`). 딥링크 프롬프트는 2000자 한도라 지침을 담을 수 없고, 폴더의 CLAUDE.md는 세션이 자동으로 읽는다. 서버가 시작할 때 `ensureGuide()`가 첫 줄의 버전 표시(`<!-- claude-office guide v1 -->`)를 보고 없거나 다르면 쓴다. 사용자가 손으로 고친 내용은 버전이 같으면 보존된다.
3. 지침 내용(`FACILITATOR_GUIDE`, `domain/meeting.mjs`):
   1. 역할: 데일리 스크럼 진행자. 읽는 것은 프롬프트에 적힌 오늘 일지 파일과 사용자 말뿐. 레포·볼트·다른 파일 조사 금지, 코드 수정 금지, git 명령 금지.
   2. 순서: ① 일지 읽기 → ② 첫 메시지로 "어제 끝낸 일 / 못 끝낸 일 / 오늘 추천" 번호 목록(추천엔 근거 한 줄, 못 끝낸 일은 그대로 이어갈지 물음) → ③ 사용자와 조정 → ④ 결정된 항목을 CLI로 칠판에 쓰기(폴더는 일지의 최근 프로젝트 폴더 목록에서, 애매하면 물음; 이미 칠판에 있는 것은 중복 추가 금지, 필요하면 update) → ⑤ "오늘 할 일 N개 칠판에 적음" 한 줄과 목록으로 마무리(결재 보고 형식은 쓰지 않음).
   3. CLI 사용법 전문(§3)과 출력 해석법.
4. 프롬프트(`meetingPrompt(id, notePath)`, 200자 안팎):
   ```
   🏫 데일리 스크럼 #meeting-2026-09-29-1
   오늘 일지: /Users/…/.claude/office/daily/2026-09-29.md
   이 폴더의 CLAUDE.md 지침대로 회의를 시작해줘.
   ```
   `MEETING_MARK = /#meeting-(\d{4}-\d{2}-\d{2}-\d+)\b/`. 서버는 `firstPromptHead`로 진행자 세션을 알아본다(할 일 연결과 같은 방식).
5. 세션 뷰에 `meetingId: string | null` 추가. 카드·패널에 `🏫 회의` 태그.

## 3. CLI (`bin/office.mjs`)

```
node <ROOT>/bin/office.mjs todo list                                  # 오늘 칠판 { todos, deleted, folders }
node <ROOT>/bin/office.mjs todo add "제목" --folder /abs/path [--detail "…"] [--source scrum]
node <ROOT>/bin/office.mjs todo update <id> [--title "…"] [--detail "…"] [--folder …] [--done true|false]
node <ROOT>/bin/office.mjs todo delete <id>
node <ROOT>/bin/office.mjs folders                                    # 최근 프로젝트 폴더
```

- `node:util`의 `parseArgs`로 파싱. usecases(`todos.mjs`)를 직접 부른다(서버 불필요, 같은 검증·같은 파일). `OFFICE_HOME`을 존중한다.
- 출력은 항상 JSON 한 덩어리(stdout). 실패는 exit 1 + `{ "error": "…" }`. 사용법 오류도 같은 형태.
- `--source scrum`이면 `TodoRecord.source = 'scrum'`(1조각 §11의 확장 지점). `createTodo(raw, now, { source })`로 넘긴다. HTTP 생성은 여전히 `manual`.
- 지침 속 경로는 `CLI_PATH`(config, `path.join(ROOT, 'bin/office.mjs')`)로 채워 넣는다.

## 4. 오늘 일지 (`~/.claude/office/daily/YYYY-MM-DD.md`)

```markdown
---
date: "2026-09-29"
type: office-daily
---
# 2026-09-29

<!-- office:auto:start -->
## 어제 세션 (2026-09-28 00:00 이후)
1. <제목> — <상태 라벨> · <+추가 −삭제 · 파일 n> · 📋 <연결 할 일 제목>
   1. 한 줄 요약: <report['한 줄 요약'] 첫 항목 또는 preview 앞 120자>
   2. 다음 작업 추천: <nextTasks 제목들 ' / '로>
## 칠판 (지금)
1. ☐ <제목> — <project>            (open)
2. ◐ <제목> — <project> · <동물 라벨> <칩 라벨>   (started)
3. ☑ <제목> — <project> · 완료 HH:MM  (done)
## 최근 프로젝트 폴더
1. <name> — <path>
<!-- office:auto:end -->

## 회의 1 (09:12 ~ 09:31)
1. 오늘 할 일 확정 n개
   1. ☐ <제목> — <project>
2. 진행자 마지막 메시지
   > <lastMessage 앞 1200자, 줄마다 '> '>
```

- 순수 함수(`domain/daily-note.mjs`):
  - `autoSection({ date, sessions, todos, folders })` → 마커 포함 문자열. `sessions`는 전날 0시 이후 `lastAt`인 후보 전부(결재함 밖은 lean 정보: 제목·상태만). 상태 라벨 표 `STATUS_LABEL = { working:'작업 중', review:'결재 대기', question:'질문 중', blocked:'막힘', hold:'보류', done:'완료', archived:'보관', stale:'지난 세션', unknown:'상태 미상' }`.
  - `replaceAuto(text, auto)`: 마커 구간이 있으면 교체, 없으면 frontmatter·제목 뒤(없으면 새 문서)에 삽입. 마커 밖은 그대로.
  - `meetingSection({ n, startedAt, endedAt, todos, lastMessage })`, `appendSection(text, section)`.
  - `noteSkeleton(date)`: frontmatter + `# date`.
- `sources/daily-notes.mjs`: `pathFor(date)`, `read(date) -> string|null`, `write(date, text)`(원자적, `DAILY_DIR` 생성).
- 3조각은 자동 구간 뒤에 AI 서술 섹션을 넣고 주기적으로 실행한다 → `2026-09-29-daily-narrative-design.md` (구현 완료).

## 5. API (추가만)

| 요청 | 응답 |
|---|---|
| `GET /api/meeting` | `{ date, note: { path, exists }, session: SessionView \| null, ended: boolean, count: number }` |
| `POST /api/meeting/start` | `{ ok: true, opened, note, id }` (일지 갱신 → `count+1` → 딥링크). 폴더 `OFFICE_DIR` 생성 보장 |
| `POST /api/meeting/end` | `{ ok: true, note, n }` (진행자 아카이브 + `## 회의 n` 추가). 진행자 없어도 칠판만 기록 |
| `GET /api/sessions` | 세션마다 `meetingId` 추가 |

- `session` = 오늘 날짜의 진행자 세션 중 표식 번호가 가장 큰 것(결재함에 있으면 완전한 뷰, 없으면 lean + `lastMessage`는 `lastAssistantText`로 채움). `ended` = 그 세션이 아카이브됨. `count` = 오늘 시작한 회의 수(표식 최대 번호).
- 라우팅은 `/api/<name>/<id>` 두 단계라 `POST /api/meeting/start`는 `name='meeting'`, `id='start'`로 들어온다. 핸들러가 `id`로 `start`/`end`를 가른다(`GET /api/meeting`은 id 없음).

## 6. 화면

```
┌ 헤더: 오늘의 사무실  [출근][결재 대기][보류]  🏫 회의실  🗄️ 보관함 🔔 ┐
│ ┌📋 오늘의 할 일 (기존 칠판, 크게) ┐ ┌ 🏫 회의실 ─────────────────────┐ │
│ │ ☐ 결제 모듈 리팩터링 [시작]      │ │      🐸 진행자 (책상·말풍선)      │ │
│ │ ☐ 회의록 정리 🐰 작업 중        │ │  ┌ 최근 메시지 (마크다운) ──────┐ │ │
│ │ + 할 일 추가                    │ │  │ 1. 어제 끝낸 일 …            │ │ │
│ └───────────────────────────────┘ │  └─────────────────────────────┘ │ │
│                                   │ [회의 시작] [채팅 열기] [회의 끝]  │ │
│                                   │ 일지: ~/.claude/office/daily/…   │ │
│                                   └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

1. 전환: 헤더 `🏫 회의실` 버튼(토글, `aria-pressed`) → `body.screen-meeting` + `location.hash = '#meeting'`. 새로고침해도 해시로 복원. Esc는 패널이 닫힌 상태에서만 회의실을 닫는다(기존 Escape 처리와 충돌 없게).
2. 배치(`meeting.css`): `screen-meeting`이면 `.kanban`·`#split-office`·`.office-decor`·`#desks`·`#split-blackboard`를 숨기고 `.office`를 2열(칠판 | 회의실 패널)로. 칠판 요소는 그대로 쓰므로 `blackboard.js`는 손대지 않는다(접힘 상태는 회의실에서 무시하고 펼침).
3. `views/meeting.js`: `mountMeeting(el, { onChange })`, `renderMeeting(meeting, todos)`.
   1. 진행자: 세션이 있으면 그 동물 스프라이트(`<use href="#animal-…">`) + 상태 말풍선(작업 중 "정리 중…", 결재 대기·질문 "답 기다리는 중", 끝남 "회의 끝"), 없으면 빈 책상 "진행자 대기 중".
   2. 최근 메시지: `session.lastMessage`를 `renderMarkdown`(보고서 탭과 같은 `.report-sec` 스타일). 없으면 "회의 시작을 누르고 앱에서 Enter를 누르면 진행자가 어제 기록을 정리해요."
   3. 버튼 상태 표: 세션 없음 → [회의 시작]; 진행 중 → [채팅 열기][회의 끝]; 끝남 → [회의 다시 시작]. 일지 경로 표시(클릭하면 복사).
   4. 회의 시작 토스트 "진행자 입력창을 열었어요 · Enter만 누르세요", 회의 끝 → `stampFx('끝')` + 사무실로 복귀.
4. 폴링: `main.js`가 `screen-meeting`일 때만 `/api/meeting`도 함께 부른다.
5. 칠판 항목 `source === 'scrum'`이면 제목 앞 작은 🏫(`blackboard.js` 한 줄).
6. 결재함 카드·패널: `session.meetingId`면 `🏫 회의` 태그(📋 태그와 같은 자리).

## 7. 모듈

| 파일 | 레이어 | 내용 |
|---|---|---|
| `src/domain/meeting.mjs` (새) | domain | `MEETING_MARK`, `meetingMarker(id)`, `meetingIdIn(text)`, `meetingId(date, n)`, `meetingPrompt(id, notePath)`, `GUIDE_VERSION`, `facilitatorGuide({ cliPath })` |
| `src/domain/daily-note.mjs` (새) | domain | §4의 순수 함수들, `STATUS_LABEL` |
| `src/sources/daily-notes.mjs` (새) | sources | `pathFor`, `read`, `write` |
| `src/sources/office-guide.mjs` (새) | sources | `ensureGuide(text, version)` |
| `src/usecases/meeting.mjs` (새) | usecases | `getMeeting(now)`, `startMeeting(now)`, `endMeeting(now)`, `facilitators(now)`(오늘 표식 세션들) |
| `src/usecases/todos.mjs` | usecases | `createTodo(raw, now, { source = 'manual' })` |
| `src/usecases/list-sessions.mjs` | usecases | `meetingId` 필드 |
| `bin/office.mjs` (새) | cli | §3 |
| `src/http/routes.mjs`, `server.mjs` | http | 라우트, 시작 시 `ensureGuide` |
| `src/config.mjs` | config | `DAILY_DIR`, `GUIDE_FILE`, `CLI_PATH`, `ROOT` export 확인 |
| `public/js/views/meeting.js`, `public/css/meeting.css` (새) | ui | §6 |
| `public/js/api.js`, `store.js`, `main.js`, `index.html`, `views/board.js`, `panel/panel.js`, `views/blackboard.js` | ui | 연결 |

## 8. 테스트

| 파일 | 확인 |
|---|---|
| `test/unit/daily-note.test.mjs` | 자동 구간 내용(상태 라벨·연결 할 일·다음 작업), `replaceAuto`가 회의 섹션 보존, 마커 없는 문서에 삽입, 빈 세션·빈 칠판 |
| `test/unit/meeting.test.mjs` | 표식 정규식·id 형식, 프롬프트 ≤ 2000자에 표식·경로 포함, 지침에 CLI 명령 5종·금지 규칙 포함, 버전 표시 |
| `test/integration/cli.test.mjs` | add/list/update/delete/folders, `--source scrum`, 잘못된 인자 exit 1 JSON, `OFFICE_HOME` 격리 |
| `test/integration/meeting.test.mjs` | start(dry) → 일지 생성·딥링크 표식·`count 1`, 표식 든 가짜 세션 → `session`·`meetingId`, end → 아카이브·`## 회의 1`·`ended`, 다시 start → `-2`와 자동 구간 재생성에도 회의 1 보존, 서버 시작 시 CLAUDE.md 생성과 버전 갱신·사용자 수정 보존 |
| 브라우저(데모) | 전환·해시 복원·버튼 3상태·메시지 렌더·칠판 실시간·🏫 태그·375px |

## 9. 작업 순서

1. 백엔드·프론트 서브에이전트 병렬(파일 겹치지 않음) → 2. 통합 검증(데모 + 실제 회의 한 번) → 3. README 한/영, 이 문서 상태, 스크린샷 → 커밋마다 테스트.

## 10. 정한 기본값

1. 진행자 폴더 `~/.claude/office`, 지침은 CLAUDE.md(서버 관리, 버전 v1), 프롬프트는 표식·일지 경로만
2. 진행자는 CLI로만 쓰기, `source: 'scrum'`
3. "어제" = 전날 0시 이후 활동 세션
4. 회의 끝 = 진행자 아카이브 + 일지 기록. 하루 여러 번(`회의 n`)
5. 회의실 = 같은 DOM의 배치 전환, 칠판 재사용
6. git 레포가 아닌 폴더로 `claude://code/new` 딥링크가 열리는지: 앱이 Finder 서비스 "New Claude Code Session Here"에서 임의 폴더를 같은 딥링크로 넘기도록 등록해 두어 열린다(앱 번들 문자열로 확인). 실제 첫 회의에서 한 번 더 확인

## 11. 구현하며 달라진 점

1. 서버
   1. `replaceAuto(text, auto, date)`: 일지가 없을 때 뼈대를 만들려면 날짜가 필요해 인자를 추가.
   2. 일지의 `## 어제 세션`에서 진행자 세션 제외, `folders()`에서 `OFFICE_DIR` 제외(진행자 폴더가 프로젝트처럼 보이지 않게).
   3. `facilitators` 항목에 `startedAt`(앱 파일 `createdAt`) 추가해 `## 회의 n` 시작 시각에 사용.
   4. 회의 시작 직후 `count`는 0이고, 사용자가 Enter를 눌러 진행자 세션이 실제로 생겨야 1이 된다(표식에서 계산).
   5. 일지 없이 회의 끝을 누르면 뼈대와 자동 구간을 먼저 만들고 섹션을 붙인다. 빈 섹션은 `1. 없음`.
   6. `lean()`을 `todo-links.mjs`에서 복사(그 파일은 담당 밖). 세 번째 사용처가 생기면 export로 합치기.
   7. 데모 진행자 seed는 `--once`가 아닐 때만(기존 `office.test.mjs`의 세션 수 단언 유지).
   8. 통합 테스트 포트 7791.
2. 화면
   1. 도장은 `stampFx` 대신 `meeting.js`의 `stamp()`: 기존 도장 레이어가 패널 안에 있어 패널이 닫혀 있으면 화면 밖에 그려진다.
   2. 해시는 `history.replaceState`(방문 기록을 쌓지 않음), `hashchange`에도 반응.
   3. 세션은 있는데 답이 없으면 "진행자가 아직 답하지 않았어요. 대화는 앱 채팅창에서 해요." 안내.
   4. 요청이 진행 중이면 버튼 전체를 막는다(시작·끝 동시 전송 방지). 회의실에서는 칠판 접기 버튼을 숨긴다.
   5. Escape: 패널 → 회의실 순서로 닫고, dialog가 열려 있으면 회의실을 닫지 않는다.
   6. 제목 옆 sub 줄에 `날짜 · 오늘 회의 n번 · 칠판에 🏫 n개`.
3. 검증(데모): 회의실 전환·해시 복원 → 진행자 메시지 렌더(번호 목록) → 회의 끝(도장·토스트·사무실 복귀·진행자 아카이브) → 일지에 자동 구간 + `## 회의 1`(확정 목록·`> ` 메시지) 확인 → CLI `todo add --source scrum` → 칠판 🏫 표시 → 375px. 테스트 100개 → 121개, 메트릭 4개 통과.
4. 실제 첫 회의(2026-09-29 00:03)에서 발견해 고친 것 (`GUIDE_VERSION` 2)
   1. 앱이 `folder=~/.claude/office`를 무시하고 scratch 작업 공간에 세션을 열었다(첫 메시지에 "without choosing a project folder" 안내). 그래서 `OFFICE_DIR/CLAUDE.md`가 읽히지 않았다 → 프롬프트에 `지침: <절대 경로>`를 넣고 "지침 파일을 먼저 읽고 진행"하도록 바꿈. §10.6의 앱 번들 근거는 Finder 서비스에만 해당했다.
   2. 실제 대화 기록은 첫 프롬프트 앞에 약 30KB의 preamble(queue 항목, hook 첨부)이 있어 16KB 헤드에서 표식을 못 찾았다(데모 기록은 작아 테스트가 못 잡음) → `HEAD_BYTES` 256KB. `#todo-` 연결도 같은 코드라 함께 고쳐짐.
5. 남은 것
   1. 실제 회의 한 바퀴(회의 시작 → 앱에서 Enter → 진행자와 대화 → CLI 기록 → 회의 끝)는 사용자 테스트 몫. 진행자의 Bash 권한 확인이 매번 뜨면 `~/.claude/office/.claude/settings.json` 허용 규칙 검토. → 실제로 뜬 것은 지침·일지 `Read` 확인이었고, 사용자 설정 허용 규칙으로 해결([진행자 읽기 허용](2026-09-29-facilitator-permissions-design.md)).
   2. 자정을 걸친 회의는 "오늘" 진행자로 잡히지 않는다.
