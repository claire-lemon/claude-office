# 설계: 연결 기록 (할 일 ↔ 세션 이력, 4/4)

- 작성일: 2026-09-29
- 상태: 설계 (구현 전, 브랜치 `feat/todo-history`)
- 전체 그림: `2026-09-28-todo-blackboard-design.md` 머리의 4조각 표. 이 문서는 마지막 4조각이다. 1조각의 연결 인덱스(§6.2)와 3조각의 일지·AI 서술(`2026-09-29-daily-narrative-design.md`) 위에 얹는다.

## 1. 목적

1. 할 일마다 거쳐 간 세션 **전부**(재시도, "다음 작업 ▶ 진행"으로 이어진 세션)를 시간순 이력으로 보여준다. 칠판, 일지, 보관함 세 곳에서.
2. 대화 기록이 지워져도 연결과 완료 상태가 남게 한다(§2의 30일 문제).
3. 어제 끝낸 할 일을 일지에 남겨 회의 진행자와 AI 서술이 보게 한다.

## 2. 사실 (조사 결과)

| 항목 | 사실 | 근거 |
|---|---|---|
| 연결 계산 | 매 조회 때 모든 세션의 대화 기록 앞부분에서 `#todo-` 표식을 찾는다. 저장하지 않는다 | `src/usecases/todo-links.mjs:39` |
| 대화 기록이 없으면 | `firstPromptHead`가 `''`를 돌려줘 연결이 사라진다 | `src/sources/transcripts.mjs` `firstPromptHead` catch |
| 대화 기록 보존 | Claude Code는 마지막 활동 기준 `cleanupPeriodDays`(기본 30일)가 지난 대화 기록을 지운다. `~/.claude/settings.json`에 설정 없음. 실제 가장 오래된 기록 2026-08-31(84개 중), 앱 세션 파일은 2026-06-02 것까지 112개 남아 있음 | Claude Code 설정 문서, 로컬 파일 mtime |
| 연결이 사라진 할 일 | 세션이 없고 수동 체크도 없으면 `open` → 칠판은 `open`을 항상 보인다. **세션으로 끝낸 할 일이 30일 뒤 대기 상태로 칠판에 되살아난다** (코드로 추론, 칠판 실사용이 아직 없어 관측은 안 됨) | `src/domain/todo.mjs:68-69`, `:83`, `src/usecases/todos.mjs:50` |
| 칠판 표시 | 항목마다 최근 세션 하나(`latest`)만 보인다. 이전 세션은 응답(`sessions`)에만 있음 | `public/js/views/blackboard.js:75` |
| 완료 항목 | 완료한 날 자정이 지나면 칠판·일지 `## 칠판 (지금)`에서 사라진다. 어제 끝낸 할 일은 일지 어디에도 없다 | `src/domain/todo.mjs:83`, `src/usecases/meeting.mjs:100` |
| AI 서술 입력 | 세션마다 `칠판 할 일: <제목>` 한 줄뿐, 할 일 단위 흐름은 없음 | `src/domain/daily-note.mjs:117` |
| 보관함 | 아카이브한 세션만(`decisions.json` 스냅샷: 제목·요약·lastAt). 할 일은 볼 곳이 없음 | `src/usecases/decide.mjs:24`, `:41` |
| 실사용 | `~/.claude/office/todos.json` 없음(칠판 사용 0건). 첫 회의(2026-09-29 00:03)도 확정 0개 | 로컬 파일, 오늘 일지 `## 회의 1` |

## 3. 설계

```
                 ┌ 대화 기록 앞부분의 #todo- 표식 (살아 있는 연결) ─┐
linkIndex ───────┤                                               ├─▶ mergeLinks ─▶ Map<todoId, LinkedSession[]>
                 └ links.json (본 적 있는 연결의 스냅샷) ◀─ 바뀐 것만 저장 ┘        │
                                                                                  ├─▶ 칠판: 최근 세션 + [+n] 펼치면 이력
                                                                                  ├─▶ 일지 자동 구간 `## 할 일 기록`
                                                                                  ├─▶ AI 서술 입력 `<todos>`
                                                                                  └─▶ 보관함 "지난 할 일" (GET /api/todo-history)
```

### 3.1 연결 기록 저장 (`~/.claude/office/links.json`)

```ts
type LinksFile = Record<SessionId, LinkRecord>;
type LinkRecord = {
  todoId: TodoId;
  title: string; animal: string;
  status: SessionStatus | 'archived' | 'stale';
  decidedAt: number | null;
  lastAt: number;
  seenAt: number;            // 처음 연결을 본 시각
};
```

1. **살아 있는 연결이 우선**: 표식으로 찾은 연결은 지금처럼 완전한 뷰(결재함) 또는 lean 뷰를 쓴다.
2. **저장은 바뀐 것만** (`linkChanges(stored, live, now)`, 순수): 새 연결이거나 `todoId·title·status·decidedAt` 중 하나가 달라진 항목만 upsert한다. `lastAt`만 바뀐 경우는 쓰지 않는다(2초 폴링마다 쓰지 않게). 세션 상태는 턴마다 작업 중 ↔ 멈춤(결재 대기·질문 등)으로 바뀌므로 `lastAt`도 턴 단위로는 갱신된다.
3. **사라진 연결** (`mergeLinks(stored, live)`, 순수): 표식이 안 보이는 저장 항목은 스냅샷으로 남긴다. 상태가 `done`·`archived`면 그대로, 그 밖(작업 중 등)은 `stale`(세션이 이미 없으므로). `column = columnOf(status)`.
4. 결과 모양은 지금의 `Map<todoId, LinkedSession[]>` 그대로라 `listTodos`·`startTodo`·`todoStatus`는 바뀌지 않는다. 할 일 상태 규칙(1조각 §5)도 그대로다.
5. 파생 상태 원칙과의 관계: `links.json`은 원본이 아니라 "관측 기록"이다. 원본(대화 기록)이 있는 동안은 항상 원본이 이긴다. `decisions.json`이 아카이브 때 제목·요약을 스냅샷으로 남기는 것과 같은 이유다.

### 3.2 이력 한 줄 (순수)

```
domain/daily-note.mjs (동물·상태 라벨이 여기 있음)
  historyLine(session) = `<동물 라벨> <세션 제목> — <상태 라벨> · MM-DD HH:MM`   (결정이 있으면 decidedAt, 없으면 lastAt)
  todoHistory(view)    = view.sessions를 오래된 순으로 historyLine
domain/todo.mjs
  touchedSince(view, since) = createdAt · doneAt · deletedAt · manual.at · 세션 lastAt 중 하나라도 since 이후
```

### 3.3 일지 `## 할 일 기록` (자동 구간 안, `## 칠판 (지금)` 다음)

```markdown
## 할 일 기록 (2026-09-28 00:00 이후)
1. ☑ 결제 모듈 리팩터링 — api · 완료 09-28 18:20 · 세션 2개
   1. 토끼 결제 리팩터링 1차 — 보관 · 09-28 11:02
   2. 강아지 결제 리팩터링 2차 — 완료 · 09-28 18:20
2. ◐ 회의록 정리 — web · 세션 1개
   1. 고양이 회의록 초안 — 결재 대기 · 09-29 00:40
3. ✕ 배포 스크립트 — infra · 삭제 09-28 15:00
```

1. 대상: `touchedSince(view, startOfYesterday(now))`인 할 일 전부(삭제된 것 포함), 생성 순.
2. `## 칠판 (지금)`과 겹칠 수 있다. 칠판은 "지금 상태"(진행자가 중복 추가를 피하는 데 씀), 기록은 "어제부터의 이력"이다.
3. 자동 구간 안이라 회의 시작·AI 서술 때마다 다시 쓰이고, 지난 날짜 일지는 그대로 남는다. 일지 파일이 하루 단위 영구 기록이 된다.

### 3.4 AI 서술 입력

1. `narrativeInput({ since, sessions, todos })`: `</sessions>` 뒤에 `<todos>` 블록(§3.3과 같은 줄들).
2. `NARRATIVE_SYSTEM` 규칙 2에 "칠판 할 일로 묶인 세션들은 그 할 일 이름으로 한 항목에" 추가.

### 3.5 칠판 화면

1. 세션이 2개 이상인 항목: 워커 칩 옆에 `+n` 버튼(`aria-expanded`). 누르면 항목 아래에 이전 세션 목록(오래된 순, 동물 얼굴·제목·상태 칩·날짜). 결재함에 있는 세션은 클릭하면 패널이 열린다(지금 워커 칩과 같은 규칙).
2. 펼침 상태는 모듈 안 `Set<todoId>`에 두어 2초 폴링 재렌더에도 유지한다. 새로고침하면 접힌다.

### 3.6 보관함 "지난 할 일"

1. `GET /api/todo-history` → `{ todos: TodoView[] }`: 칠판에 안 보이는 할 일 전부(어제 이전에 완료, 삭제됨). 완료·삭제 시각 최근순.
2. 보관함 창: 기존 세션 표 아래에 `지난 할 일` 표 — 할 일 · 프로젝트 · 결과(`완료 09-28` / `삭제 09-28`) · 세션(제목을 ` → `로 시간순). 창을 열 때 한 번 불러온다(폴링에 넣지 않음).
3. 되살리기 버튼은 두지 않는다(삭제 되돌리기는 칠판의 "오늘 지운 항목" 몫).

## 4. 모듈

| 파일 | 레이어 | 내용 |
|---|---|---|
| `src/config.mjs` | config | `LINKS_FILE` |
| `src/sources/links.mjs` (새) | sources | `load()`, `saveMany(records)` (json-store 원자적 쓰기) |
| `src/domain/todo.mjs` | domain | `linkChanges`, `mergeLinks`, `touchedSince` |
| `src/usecases/todo-links.mjs` | usecases | `linkIndex`: 살아 있는 연결 + 저장 연결 병합, 바뀐 것 저장 |
| `src/usecases/todos.mjs` | usecases | 내부 `allViews(now)`(삭제 포함), `listTodos`는 그 위 필터로(결과 동일), `todoHistory(now)` 추가 |
| `src/domain/daily-note.mjs` | domain | `historyLine`, `todoHistory`, `autoSection`에 `history` 인자 → `## 할 일 기록`, `narrativeInput`에 `todos`. 칠판 기호표(`☐◐☑`)에 삭제 `✕` 추가 |
| `src/domain/prompts.mjs` | domain | `NARRATIVE_SYSTEM` 규칙 2 한 줄 |
| `src/usecases/meeting.mjs`, `narrate.mjs` | usecases | 일지·서술에 할 일 이력 전달 |
| `src/http/routes.mjs` | http | `GET /api/todo-history` |
| `public/js/views/blackboard.js`, `public/css/blackboard.css` | ui | §3.5 |
| `public/js/views/archive.js`, `public/js/api.js`, `public/index.html` | ui | §3.6 |

## 5. API (추가만)

| 요청 | 응답 |
|---|---|
| `GET /api/todo-history` (새) | `200 { todos: TodoView[] }` |
| `GET /api/todos` | 모양 그대로. `sessions`에 대화 기록이 지워진 세션도 스냅샷으로 들어온다(상태 `done`·`archived`·`stale`) |

## 6. 테스트

| 파일 | 확인 |
|---|---|
| `test/unit/todo.test.mjs` | `linkChanges`: 새 연결·상태 변화만 upsert, `lastAt`만 바뀌면 없음, `seenAt` 유지. `mergeLinks`: 살아 있는 쪽 우선, 사라진 항목 `done`·`archived` 유지·나머지 `stale`. `touchedSince` 각 필드 |
| `test/unit/daily-note.test.mjs` | `historyLine`·`todoHistory` 순서, `## 할 일 기록` 줄 모양(☑·◐·✕, 세션 하위 목록, 없으면 `1. 없음`), `narrativeInput`의 `<todos>` |
| `test/integration/todos.test.mjs` | 표식 세션으로 연결 → `links.json` 생성 → **대화 기록 파일 삭제 후에도** 연결 유지·할 일 `done` 유지(30일 문제 회귀 테스트), 작업 중이던 세션은 `stale`·할 일 `started`. 폴링 반복에도 `lastAt`만 바뀌면 파일 mtime 그대로. `GET /api/todo-history`에 어제 완료·삭제 항목 |
| `test/integration/meeting.test.mjs`, `narrate.test.mjs` | 일지에 `## 할 일 기록`, 서술 입력에 `<todos>` |
| 브라우저(데모 7770) | `+n` 펼침·폴링 유지·세션 클릭, 보관함 "지난 할 일", 375px |

## 7. 작업 순서

1. 백엔드(§3.1~3.4, §5 + 단위·통합 테스트)와 프론트(§3.5~3.6)를 서브에이전트 2개로 병렬 진행. 파일이 겹치지 않는다(계약은 §3·§5).
2. 통합 검증: 테스트, 메트릭, 데모 브라우저, 실제 홈에서 `node bin/office.mjs todo list`로 `links.json` 생성 확인.
3. README 한/영, 이 문서 상태 갱신. 단계마다 테스트 통과 후 커밋.

## 8. 롤백

1. 새 파일은 `links.json` 하나. 지우면 지금처럼 파생 연결만 남는다(다음 조회에서 살아 있는 연결로 다시 만들어짐).
2. API는 `GET /api/todo-history` 추가뿐, 기존 응답 모양은 그대로.
3. 일지의 `## 할 일 기록`은 자동 구간 안이라 코드를 되돌리면 다음 갱신 때 사라진다.

## 9. 정한 기본값 (바꾸려면 알려주세요)

1. 연결 스냅샷은 별도 파일 `links.json`(할 일 원본 `todos.json`에는 사용자가 적은 것만 둔다는 1조각 원칙 유지)
2. 사라진 세션: 완료·보관은 그대로, 나머지는 `stale`
3. 일지 `## 할 일 기록`은 어제 0시 이후 건드린 할 일 전부, `## 칠판 (지금)`과 겹쳐도 둠
4. 보관함에 "지난 할 일" 표 추가(되살리기 없음)
5. 칠판 이력은 `+n` 펼치기, 새로고침하면 접힘
6. 진행자 지침은 바꾸지 않음(일지 전체를 읽으므로 `## 할 일 기록`도 읽는다)
