# 설계: 오늘의 할 일 칠판 (할 일 ↔ 세션 연결, 1/4)

- 작성일: 2026-09-28
- 상태: 설계 (승인 대기)
- 전체 그림: "할 일(이슈) ↔ 세션(PR)"을 잇는 하루 루프. 네 조각으로 나누고 이 문서는 1조각이다.

  | 조각 | 내용 | 의존 | 문서 |
  |---|---|---|---|
  | 1 | **할 일 칠판 + 시작**: 할 일 저장소, 사무실 칠판, [시작] → 새 세션, 세션 자동 연결 | 없음 | 이 문서 |
  | 2 | 회의실(daily scrum): 화면 전환, 어제 일지·세션으로 끝낸 일/못 끝낸 일/추천 초안 → 칠판 확정, "프롬프트 다듬기" | 1 | 별도 |
  | 3 | 업무일지: 어제 세션 전부 조사 → `~/.claude/office/daily/YYYY-MM-DD.md` 생성(주기 + 수동) | 1 | 별도 |
  | 4 | 연결 기록: 할 일↔세션 이력, 일지 반영, 보관 | 1, 3 | 별도 |

- 전제: `2026-09-28-layering-and-panel-design.md`의 레이어 규칙, `2026-09-28-board-interactions-design.md`의 "규칙은 표, 서버가 계산" 원칙을 그대로 따른다.

## 1. 목적

1. 오늘 할 일을 사무실 칠판에 적어 두고, 항목마다 [시작]으로 프롬프트가 채워진 새 세션을 연다.
2. 그 세션(워커)이 할 일에 자동으로 붙고, 세션이 컨펌·아카이브되면 할 일이 완료된다.
3. 2~4조각이 얹힐 자리(저장 형식, 상태 규칙, 프롬프트 템플릿)를 미리 잡되, 1조각에는 넣지 않는다.

## 2. 사실 (조사 결과)

| 항목 | 사실 |
|---|---|
| 개인 노트 | `~/lemoncloud/knowledge/private/YYYY-MM-DD.md` (git 미추적). 자유 형식 `###` 섹션에 체크박스 사용(미완 66 / 완료 95). 이 앱은 **읽지도 쓰지도 않는다**(사용자 결정: 앱 전용 일지를 따로 둔다) |
| 새 세션 열기 | `claude://code/new?q=<prompt>&folder=<path>` 딥링크. 폴더 필수. `src/usecases/next-task.mjs`가 이미 사용 |
| 세션 식별 | 앱 세션 파일(`sessionId`, `cliSessionId`, `originCwd`, `title`), hook 상태(`transcript_path`), 대화 기록 `.jsonl` |
| 대화 기록 읽기 | `src/sources/transcripts.mjs`는 끝부분만 읽는다(`lastAssistantText`). 앞부분 읽기는 없음 |
| 결정 저장 | `decisions.json`: 세션당 `{ kind: confirm\|hold\|archive, at }` 하나. 더 새로운 hook 이벤트가 오면 무효 |
| 사무실 배치 | `.office`는 flex(장식 열 + `#desks`). `#desks` 폭이 바뀌면 `ResizeObserver`가 책상 크기를 다시 맞춘다 |

## 3. 아키텍처와 디자인 패턴

```
브라우저                              서버 (127.0.0.1:7777)                     파일
┌──────────────────┐   GET /api/todos   ┌─────────────────────────┐        ┌──────────────────┐
│ views/blackboard │ ◀───────────────── │ usecases/todos.mjs      │ ◀───── │ todos.json       │
│  (보여주기·편집)   │   POST/DELETE      │   ├ domain/todo.mjs     │        │ decisions.json   │
│                  │ ─────────────────▶ │   │  (상태 표·프롬프트)     │        │ 앱 세션 파일       │
│ [시작] ──────────┼── POST /api/start ─▶│   ├ usecases/todo-links │ ◀───── │ hook 상태         │
└──────────────────┘                    │   │  (표식 → 세션 연결)     │        │ 대화 기록 앞 16KB  │
                                        │   └ platform/macos open │ ─────▶ │ claude:// 딥링크   │
                                        └─────────────────────────┘        └──────────────────┘
```

1. **파생 상태 (derived state)**: 저장하는 것은 사용자가 적은 것뿐이다. 할 일의 상태·연결 세션·완료 시각은 매 조회 때 서버가 계산한다. 원본이 하나라 컨펌 취소·보관함 복구·새 hook 이벤트가 와도 어긋나지 않는다. 결재함의 `column`·`moves`와 같은 방식.
2. **상관 표식 (correlation marker)**: 새 세션 프롬프트 첫 줄에 `#todo-<id>`를 넣고, 서버가 대화 기록 앞부분에서 그 표식을 찾아 세션을 할 일에 붙인다. 추적 ID를 요청에 실어 보내는 것과 같은 원리. 폴더·시간 추정보다 결정적이고, "다음 작업 ▶ 진행"으로 이어진 세션에도 표식을 물려주면 체인이 유지된다.
3. **규칙은 표**: 상태 판정(§5), 프롬프트 템플릿(§7), 편집 가능 필드(§4)는 데이터·순수 함수다. 2조각에서 "회의실이 만든 할 일"을 붙일 때 표에 값만 더한다.
4. **레이어와 의존 방향**: `http → usecases → domain · sources · platform`. `domain/todo.mjs`는 파일·시각·프로세스에 접근하지 않고 `now`를 인자로 받는다. 파일 쓰기는 `sources/todos.mjs`, 딥링크 열기는 `platform/macos.mjs`에만 있다.
5. **낙관적 갱신 + 폴링 수렴**: 체크·삭제·시작은 화면을 먼저 바꾸고 서버에 보낸 뒤, 2초 폴링이 서버 값으로 맞춘다. 편집 중인 항목(`dataset.editing`)은 폴링이 덮지 않는다(이름 변경과 같은 규칙).
6. **경로별 읽기 캐시**: 대화 기록의 앞 16KB는 바뀌지 않으므로 경로 기준으로 한 번만 읽는다(끝부분 캐시가 크기·mtime 기준인 것과 대비).
7. **소프트 삭제**: 삭제는 `deletedAt`만 적는다. "되돌리기"가 같은 id를 되살려 표식 연결이 끊기지 않고, 3조각 일지가 삭제된 항목을 구분할 수 있다.

## 4. 데이터 모델

`~/.claude/office/todos.json` — 사용자가 적은 것만 저장한다.

```ts
type TodoId = string;                       // [a-z0-9]{6}, 생성 시 기존 키와 충돌 검사
type TodosFile = Record<TodoId, TodoRecord>;
type TodoRecord = {
  title: string;                            // 1~120자
  detail: string;                           // 0~2000자, 프롬프트 본문
  folder: string;                           // 새 세션을 열 절대 경로 (존재해야 함)
  createdAt: number;
  source: 'manual';                         // 2조각: 'scrum' 추가 (회의실이 만든 항목)
  manual: { state: 'done' | 'open'; at: number } | null;   // 칠판 체크/해제 기록
  deletedAt: number | null;
};
```

편집 가능 필드 표 (`domain/todo.mjs`, 이름 변경의 `normalizePatch`와 같은 방식):

```js
export const TODO_FIELDS = {
  title:  { maxLength: 120, required: true },
  detail: { maxLength: 2000 },
  folder: { path: true },                    // 문자열·절대 경로 형식만 검사. 존재 여부는 usecase가 fs로 확인
};
```

조회 응답(계산 결과):

```ts
type LinkedSession = {
  id: string; title: string; animal: string;
  status: SessionStatus | 'archived' | 'stale';   // 결재함 밖 세션은 lean 판정 (§6.2)
  column: 'working' | 'pending' | 'hold' | 'done' | null;
  lastAt: number;
  decidedAt: number | null;                 // 활성 결정(confirm|hold|archive)의 at
};
type TodoView = TodoRecord & {
  id: TodoId;
  project: string;                          // folder의 basename
  status: 'open' | 'started' | 'done';
  doneAt: number | null;                    // done일 때: manual.at 또는 세션 decidedAt
  by: 'manual' | 'session' | null;          // 무엇이 상태를 정했나
  sessions: LinkedSession[];                // 최근순
  latest: LinkedSession | null;             // sessions[0]
};
type FolderView = { path: string; name: string; lastAt: number };
```

## 5. 상태 규칙 (순수 함수 `todoStatus`)

```js
// 최근 연결 세션의 상태 -> 할 일 상태. 한 줄이 규칙 하나.
export const STATUS_OF_SESSION = {
  working: 'started', review: 'started', question: 'started', blocked: 'started',
  hold: 'started', unknown: 'started', stale: 'started',
  done: 'done', archived: 'done',
};
```

```
todoStatus({ todo, sessions, now }) -> { status, doneAt, by }
1. sessions가 비어 있으면: manual이 done이면 done(by manual), 아니면 open
2. latest = lastAt이 가장 큰 세션
   fromSession = STATUS_OF_SESSION[latest.status] ?? 'started'
   sessionAt   = fromSession === 'done' ? latest.decidedAt : latest.lastAt
3. manual이 있고 manual.at > sessionAt 이면 manual.state ('done' | 'open'→'started' *)  (by manual)
   아니면 fromSession (by session)
   * 연결 세션이 있는데 수동으로 해제하면 open이 아니라 started로 돌아온다(세션은 여전히 붙어 있으므로)
4. doneAt: by manual이면 manual.at, by session이면 latest.decidedAt
```

| 경우 | 결과 |
|---|---|
| 연결 없음 | open |
| 최근 세션 작업 중 · 결재 대기 · 보류 · 미상 · 결재함 밖(stale) | started |
| 최근 세션 컨펌(done) | done, doneAt = 결정 시각 |
| 최근 세션 아카이브 | done, doneAt = 결정 시각 |
| 컨펌 취소(undo) | 결정이 사라져 started로 복귀 |
| 보관함 복구(→보류) | started |
| 수동 체크가 세션 결정보다 최근 | 수동 값 우선 |
| 세션이 2개(첫 세션 아카이브, 둘째 작업 중) | 최근 세션 기준 → started |

칠판 표시 규칙 (`visibleToday(view, now)`): `open`·`started`는 항상, `done`은 `doneAt`이 오늘(서버 로컬 날짜)이면 취소선으로 표시, 자정이 지나면 숨김. `deletedAt`이 있으면 목록에서 제외(오늘 삭제한 것은 "되돌리기" 대상이라 응답의 `deleted: [...]`에 따로 실음).

## 6. 서버 모듈

### 6.1 파일과 시그니처

| 파일 | 레이어 | 내용 |
|---|---|---|
| `src/domain/todo.mjs` (새) | domain | `TODO_MARK = /#todo-([a-z0-9]{6})\b/`, `markerLine(id, title)`, `todoIdIn(text)`, `TODO_FIELDS`, `normalizeTodoPatch(raw, { create })`, `STATUS_OF_SESSION`, `todoStatus({ todo, sessions, now })`, `isSameLocalDay(a, b)`, `visibleToday(view, now)`, `toTodoView({ id, todo, sessions, now })` |
| `src/domain/prompts.mjs` | domain | `todoPrompt(todo, latest)` 추가 (§7). `nextTaskPrompt`는 그대로 두고 `startNextTask`가 표식 줄을 앞에 붙인다 |
| `src/sources/todos.mjs` (새) | sources | `load() -> TodosFile`, `save(id, record)`, 원자적 쓰기(json-store) |
| `src/sources/transcripts.mjs` | sources | `firstPromptHead(file) -> string` 추가: 앞 16KB(`HEAD_BYTES`), 경로별 캐시, 없으면 `''` |
| `src/sources/app-sessions.mjs` | sources | 변경 없음 (`loadAppSessions()`가 아카이브 포함 전부를 돌려주는 것을 그대로 사용) |
| `src/usecases/list-sessions.mjs` | usecases | 세션 뷰에 `todoId`, `decidedAt` 추가. 후보 조립을 `collectCandidates({ now, decisions })`로 분리해 `todo-links.mjs`가 재사용 |
| `src/usecases/todo-links.mjs` (새) | usecases | `linkIndex(boardSessions) -> Map<TodoId, LinkedSession[]>` (§6.2) |
| `src/usecases/todos.mjs` (새) | usecases | `listTodos(now)`, `createTodo(raw)`, `updateTodo(id, raw)`, `deleteTodo(id)`, `startTodo(id)` |
| `src/usecases/next-task.mjs` | usecases | 부모 세션에 `todoId`가 있으면 프롬프트 맨 앞에 `markerLine` 추가 |
| `src/http/routes.mjs` | http | 라우트 5개 (§8) |
| `src/http/server.mjs` | http | Origin 검사를 `POST`에서 **GET이 아닌 모든 메서드**로 확대 (DELETE 허용) |
| `src/config.mjs` | config | `TODOS_FILE`, `HEAD_BYTES = 16 * 1024`, `TODO_FOLDERS_LIMIT = 20` |

### 6.2 연결 인덱스 (`todo-links.mjs`)

```
linkIndex(boardSessions):
  onBoard = Map(boardSessions by id)                     // listSessions() 결과: 상태·동물·제목이 완전함
  for each candidate in collectCandidates({ now, decisions })   // DAY 필터·MAX_DESKS 없이 전부
    transcript = state.transcriptPath || transcriptPathFor(cwd, cli)
    todoId = todoIdIn(firstPromptHead(transcript));  if (!todoId) continue
    view = onBoard.get(id)
      ? pick(onBoard.get(id), id title animal status column lastAt decidedAt)
      : lean(candidate)   // 결재함 밖: status = active === 'archive' ? 'archived' : active === 'confirm' ? 'done' : 'stale'
                          // decidedAt = active ? decisions[id].at : null, lastAt = candidate.lastAt
                          // column = columnOf(status) ?? null, animal = ANIMALS[hash(id)], title = override ?? app.title ?? basename(cwd)
    index[todoId].push(view)
  each list sorted by lastAt desc
```

- 결재함에 있는 세션은 완전한 뷰를 쓰고, 24시간이 지났거나 아카이브된 세션만 값싼 판정(`lean`)을 쓴다. `lean`은 대화 기록 끝부분·git을 읽지 않는다.
- 비용: 앞 16KB 읽기는 경로별로 한 번뿐이다. 첫 요청에 앱 세션 수 × 16KB, 이후는 캐시.

### 6.3 유스케이스

```
listTodos(now = Date.now()):
  board = listSessions(now); links = linkIndex(board); file = todosStore.load()
  views = entries(file).filter(!deletedAt).map(toTodoView with links.get(id) ?? [])
  return { todos: views.filter(visibleToday), deleted: 오늘 삭제된 항목 [{id,title}], folders: folders() }

folders(): 앱 세션의 originCwd ?? cwd 중 존재하는 폴더, 최근 활동순 유일값 TODO_FOLDERS_LIMIT개, name = basename

createTodo(raw):  normalizeTodoPatch(raw, { create: true }) → folder 존재 확인(fs) → id 생성(충돌 검사) → save → view
updateTodo(id, raw): 필드 patch + { done?: boolean } → done이면 manual = { state, at: now } → save → view
                     { deleted: false }는 deletedAt을 지운다(되돌리기)
deleteTodo(id): deletedAt = now (소프트)
startTodo(id): todo·links 조회 → folder 존재 확인 → prompt = todoPrompt(todo, latest) → openUrl(newSessionLink(folder, prompt)) → { opened }
```

## 7. 프롬프트 템플릿 (`todoPrompt`, 순수)

```
📋 오늘의 할 일 #todo-a1b2c3 · 결제 모듈 리팩터링          ← markerLine(id, title). 항상 첫 줄
PG 응답 파싱을 use-case로                                  ← detail (비어 있으면 생략)
- 프로젝트: /Users/…/api-server
- 이전 세션 "결제 모듈 리팩터링 (1차)": 브랜치 feat/x, PR https://…, 한 줄 요약: …   ← latest가 있을 때(재시도)
끝나면 결재 보고로 마무리해줘.
```

- 전체 2000자 제한(`NEXT_PROMPT_LIMIT` 재사용). detail이 길면 detail을 먼저 자른다.
- "다음 작업 ▶ 진행"으로 여는 세션: 부모 세션의 `todoId`가 있으면 `markerLine` + 빈 줄 + 기존 `nextTaskPrompt`.
- 2조각의 "프롬프트 다듬기"는 이 템플릿 결과를 입력으로 `claude -p`에 넘겨 `detail`을 채우는 별도 유스케이스로 붙는다(1조각 범위 밖).

## 8. HTTP 인터페이스 (추가만)

| 요청 | 성공 | 실패 |
|---|---|---|
| `GET /api/todos` | `200 { todos: TodoView[], deleted: [{ id, title }], folders: FolderView[] }` | |
| `POST /api/todos` 본문 `{ title, detail?, folder }` | `201 { ok: true, todo }` | `400 { error }` (`title required`, `title too long`, `unknown field: x`, `folder must be an absolute path`, `folder not found`), 413/415 (기존 `readJsonBody`) |
| `POST /api/todos/:id` 본문 `{ title?, detail?, folder?, done?: boolean, deleted?: false }` | `200 { ok: true, todo }` | `404 { error: 'unknown todo' }`, 400 |
| `DELETE /api/todos/:id` | `200 { ok: true }` | 404 |
| `POST /api/start/:id` | `200 { ok: true, opened: 'claude://code/new?…' }` | 404 `unknown todo`, 404 `repo folder not found` |
| `GET /api/sessions` | 세션마다 `todoId: string \| null`, `decidedAt: number \| null` 추가 | |

- 모든 non-GET 요청에 기존 Origin 검사가 적용된다(지금은 POST만).
- 라우터는 `/api/<name>/<id>` 두 단계만 보므로 하위 동작은 메서드(DELETE)와 본문(`done`, `deleted`)으로 표현한다. `POST /api/todos`와 `POST /api/todos/:id`는 같은 라우트 키이고, 핸들러가 id 유무로 생성/수정을 가른다.

## 9. 클라이언트

| 파일 | 내용 |
|---|---|
| `public/js/views/blackboard.js` (새) | `mountBlackboard(el)`, `renderBlackboard({ todos, deleted, folders })`. 항목 렌더, 체크·시작·삭제·되돌리기 클릭, 제목 `inlineEdit`, 추가 폼 |
| `public/css/blackboard.css` (새) | 칠판(짙은 초록, 분필색 글씨), 항목, 상태 칩, 추가 폼, 접힘, 좁은 화면 |
| `public/js/api.js` | `getTodos()`, `postTodo(body)`, `patchTodo(id, body)`, `deleteTodo(id)`, `postStart(id)` |
| `public/js/store.js` | `todos = { list: [], deleted: [], folders: [] }` |
| `public/js/main.js` | 폴링에서 `/api/todos`도 호출 → `renderBlackboard`. 클릭 위임에 칠판 동작 추가 |
| `public/index.html` | `.office` 첫 자식으로 `<aside class="blackboard" id="blackboard">` + 폭 손잡이 `.split-x` |
| `public/js/views/layout.js` | 칠판 폭 손잡이(`mountSplitter`, 기본 260px, 최소 200, 최대 사무실 폭 50%, 키 `office.blackboardW`), 접기(`office.blackboardOpen`). `#desks` 폭 변화는 기존 `ResizeObserver`가 감지 |
| `public/js/views/board.js`, `public/js/panel/panel.js` | `session.todoId`가 있으면 카드·패널 헤더에 📋 태그(할 일 제목은 `todos.list`에서 찾음, 없으면 id) |

화면 규칙:

1. 항목 한 줄: `☐ 제목` · `📁 프로젝트` · 연결 워커(동물 얼굴 + 상태 칩, 클릭하면 그 세션 패널) · `[시작]`(`started`면 `[다시 시작]`) · 마우스 올리면 `🗑`.
2. `done`은 취소선 + 흐린 분필색. 체크박스는 어느 상태에서든 수동 토글.
3. `+ 할 일 추가` → 인라인 폼: 제목(필수) · 프로젝트(`<select>` 최근 폴더 + "직접 입력…") · 세부 메모(선택, `<textarea>`). Enter 저장, Esc 취소, 저장 후 폼은 닫힌다.
4. 삭제 → 즉시 사라지고 토스트 "삭제됨 · 되돌리기"(5초). 되돌리기는 `patchTodo(id, { deleted: false })`.
5. 시작 → 토스트 "새 세션 입력창을 열었어요 · Enter만 누르세요"(기존 문구). Enter 전까지 항목은 `open` 그대로.
6. 편집 중(`dataset.editing`)이거나 추가 폼이 열려 있으면 폴링이 그 항목/폼을 다시 그리지 않는다.
7. 800px 미만: 칠판이 책상 위에 가로로 놓이고 손잡이는 숨김.

## 10. 시작 흐름 (시퀀스)

```
사용자          칠판(브라우저)          서버                        Claude 앱             hook/대화 기록
 │ [시작] 클릭 ──▶ POST /api/start/:id ─▶ todoPrompt → openUrl ────▶ 새 세션 입력창(채워짐)
 │               ◀ { opened }  토스트    │                             │
 │ Enter ─────────────────────────────────────────────────────────────▶ 세션 시작 ──▶ UserPromptSubmit, .jsonl 생성
 │               2초 폴링 GET /api/todos ─▶ linkIndex: 앞 16KB에서 #todo-id 발견 → sessions=[…], status=started
 │               ◀ 항목에 🐰 작업 중 표시
 │ … 세션 컨펌(버튼/완료 칸 드롭/아카이브) ─▶ decisions.json
 │               다음 폴링 ─▶ todoStatus: latest.status done → status=done, doneAt=결정 시각 → 취소선
```

## 11. 확장 지점 (2~4조각이 붙는 곳)

| 붙일 것 | 고칠 곳 |
|---|---|
| 회의실이 만든 할 일 | `TodoRecord.source: 'scrum'` 값 추가, `createTodo`에 `source` 허용 |
| 프롬프트 다듬기 | `todoPrompt` 결과를 입력으로 하는 `usecases/refine-todo.mjs` + `POST /api/refine/:id` (`claude-cli.mjs` 재사용) |
| 업무일지 | `todos.json`의 `createdAt`·`manual`·`deletedAt`, `linkIndex`의 세션 목록이 재료. 일지 파일은 `~/.claude/office/daily/` |
| 수동 연결(워커를 할 일에 드래그) | `TodoRecord.links: string[]` 추가 → `linkIndex` 결과와 합집합. `board-dnd.js`의 `data-drop` 대상에 칠판 항목 추가 |
| 순서 바꾸기 | `TodoRecord.order` 추가, 정렬 기본값은 `createdAt` |
| 새 상태 규칙 | `STATUS_OF_SESSION` 한 줄 |

## 12. 테스트

| 파일 | 확인 |
|---|---|
| `test/unit/todo.test.mjs` (새) | §5 표 전 경우, `manual`/세션 우선순위, `visibleToday` 자정 경계(로컬 날짜), `TODO_MARK`·`todoIdIn`(본문 중간·다른 줄·`#todo-` 없는 경우), `normalizeTodoPatch`(필수·길이·경로 형식·모르는 필드·`done`·`deleted`), `todoPrompt` 내용·순서·2000자 제한 |
| `test/unit/prompts.test.mjs` | `startNextTask`용 표식 줄 결합 |
| `test/integration/todos.test.mjs` (새) | 생성→목록→수정→삭제→되돌리기, 400 각 경우, 존재하지 않는 폴더, `folders` 목록, 시작(dry run)이 표식·폴더가 든 딥링크를 여는지, 표식이 든 가짜 대화 기록 + hook으로 연결이 잡히는지, 컨펌→done · 보류→started · 아카이브→done · 되돌리기→started · 복구→started, 수동 체크 우선순위, `/api/sessions`의 `todoId`·`decidedAt`, DELETE의 Origin 검사, 결재함 밖(아카이브된) 세션의 lean 연결 |
| `scripts/simulate.mjs` | 데모에 할 일 3개 생성(하나는 표식이 든 가짜 대화 기록으로 연결, 하나는 완료) |
| 브라우저(데모 7770) | 추가·시작·체크·수정·삭제·되돌리기·접기·폭 조절·📋 태그, 375px |

## 13. 작업 순서 · 병렬화

1. 1단계: 서브에이전트 2개 병렬 (파일이 겹치지 않음)
   1. 백엔드: §6 전부 + 단위·통합 테스트 + `simulate.mjs`
   2. 프론트: §9 전부 (백엔드 응답은 §4·§8 계약을 기준으로 먼저 작성)
2. 2단계: 통합 검증(테스트, 메트릭, 데모 브라우저, 실제 데이터로 시작→연결→컨펌 한 바퀴), README 한/영, 이 문서 상태 갱신, 스크린샷
3. 단계마다 테스트 통과 후 커밋. 문제가 생기면 그 커밋만 revert.

## 14. 롤백

1. 새 파일은 `todos.json` 하나. 지우면 칠판이 빈다.
2. API는 추가만 했고 세션 응답에 `todoId`·`decidedAt` 필드만 늘었다.
3. 새 `localStorage` 키 2개(`office.blackboardW`, `office.blackboardOpen`)는 지워도 기본값으로 시작한다.
4. 프롬프트 첫 줄의 표식은 세션에 남지만 무해하다(사람이 읽는 문장).

## 15. 정한 기본값 (바꾸려면 알려주세요)

1. 할 일 원본은 오피스(`todos.json`), 옵시디언 노트는 읽지도 쓰지도 않음
2. 할 일마다 프로젝트 폴더 지정, 기본값은 최근 세션 폴더
3. [시작]은 템플릿으로 즉시, AI 작성은 2조각의 "프롬프트 다듬기"
4. 컨펌·아카이브 = 완료, 보류 = 진행 중, 수동 체크 가능, 더 최근 결정이 우선
5. 칠판은 사무실 왼쪽 벽, 기본 폭 260px, 접기 가능
6. 완료 항목은 당일만 취소선으로 보이고 자정 이후 숨김
7. 삭제는 소프트 삭제 + 5초 되돌리기
8. 제목 120자, 세부 2000자, 폴더 후보 20개
