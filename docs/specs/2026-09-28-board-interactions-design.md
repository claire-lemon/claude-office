# 설계: 결재함 상호작용 (버튼 노출 · 책상 배치 · 크기 조절 · 카드 드래그 · 필터 · 이름 변경)

- 작성일: 2026-09-28
- 상태: 구현 완료 (2026-09-28, 커밋 `7b9942a` `ef9f9d0` `1302734` `55cb4e3` `bea6e94`)
- 범위
  1. 0번: 하단 버튼 전부 노출
  2. 1번: 책상을 5석 단위로 늘림 (빈자리 유지)
  3. 2A번: 사무실·결재함·칸 크기 조절 + 책상 크기 자동
  4. 2B번: 카드를 끌어 다른 칸으로 옮김
  5. 3번: 헤더 숫자로 필터
  6. 4번: 세션 이름 변경
- 전제: `2026-09-28-layering-and-panel-design.md`의 레이어 규칙을 그대로 따른다

## 1. 목적

1. 자주 쓰는 동작을 메뉴 없이 한 번에 누른다.
2. 화면이 세션 수와 사용자가 정한 크기에 맞춰진다.
3. 결재함에서 카드를 끌어 상태를 바꾼다.
4. 보고 싶은 세션만 걸러 본다.
5. 세션 이름을 대시보드에서 바꾼다.
6. 나중에 칸·드래그 규칙·필터·편집 필드·버튼을 추가할 때 **표에 한 줄**만 더하면 되게 한다.

## 2. 현재 구조의 사실

| 위치 | 사실 |
|---|---|
| `public/js/views/office.js:76`, `:89` | 책상 10개를 고정 생성. 빈자리는 점선 책상 |
| `public/css/office.css:16-17` | 책상 폭 104px 고정. 5열, 1280px 이상에서 10열 |
| `public/js/views/board.js:10` | 상태→칸 분류가 클라이언트에 있음 |
| `public/js/views/board.js:113` | 헤더 "결재 대기" 숫자는 review+question만 셈. 칸에는 blocked도 들어감 → 숫자와 칸이 다름 |
| `public/index.html:17`, `:53` | 헤더 숫자 3개와 칸 4개가 HTML에 고정 |
| `public/js/panel/actions.js:29-41` | 요약·보류·아카이브가 ⋯ 메뉴(`overflow`) 안에 있음 |
| `src/usecases/decide.mjs:10` | `markConfirmed`: 부수효과 없이 confirm 결정만 저장하는 함수가 이미 있음 |
| `src/http/server.mjs:19-21` | 라우트 형태는 `/api/<name>/<id>` + 쿼리. 요청 본문을 읽는 코드가 없음 |
| `src/domain/session-view.mjs:16` | 제목 우선순위: 앱 파일 title → 폴더명 → cli id |
| `src/sources/decisions.mjs` | 세션당 결정 1개(confirm/hold/archive). 더 새로운 hook 이벤트가 오면 무효 |
| `src/config.mjs:22` | `MAX_DESKS = 10`. API가 세션을 최대 10개만 돌려줌 |

## 3. 유연성 원칙

1. **규칙은 표(데이터)로 둔다.** 코드는 표를 읽기만 한다. 새 칸·새 규칙·새 필터·새 편집 필드는 표에 한 줄 추가로 끝난다.
2. **상태 규칙은 서버 `domain/`에만 둔다.** 세션이 어느 칸에 있는지, 어디로 옮길 수 있는지는 서버가 계산해 응답에 싣는다(`column`, `moves`). 클라이언트는 이 값을 보여주기만 한다. 규칙이 한 곳에 있어서 화면과 서버 판단이 어긋나지 않는다.
3. **공용 부품은 실제로 여러 곳에서 쓰는 것만 만든다.**
   1. 크기 조절 손잡이: 패널 폭, 사무실 높이, 칸 폭의 3곳
   2. 인라인 편집: 지금은 이름 한 곳이지만, 한글 입력(IME) 처리가 까다로워서 따로 뗀다. 편집 필드 표(§5.5)와 짝을 이룬다.
4. **API는 필드와 엔드포인트를 추가만 한다.** 기존 필드의 의미는 바꾸지 않는다.
5. **저장한 값이 현재 구조와 안 맞으면 기본값으로 되돌린다.** 예: 칸이 5개로 늘었는데 저장된 폭이 4개분이면 균등 폭으로 시작.

## 4. 확장 지점 (나중에 기능을 붙이는 곳)

| 추가하고 싶은 것 | 고칠 곳 | 예 |
|---|---|---|
| 새 칸반 칸 | `src/domain/board.mjs`의 `COLUMN_OF` + `public/js/views/columns.js`의 `COLUMNS` (한 줄씩) | "리뷰 중" 칸 |
| 새 드래그 규칙 | `src/domain/board.mjs`의 `MOVE_RULES` 한 줄, `src/usecases/move.mjs`의 `APPLY` 한 줄 | 🗄️ 보관함 버튼에 놓으면 아카이브 |
| 새 필터 | `public/js/views/filters.js`의 `FILTERS` 한 줄 | "막힘만", "프로젝트 X만" |
| 새 하단 버튼 | `public/js/panel/actions.js` 표 한 줄 + `footer.js`의 `ACTION_HANDLERS` 한 줄 | "PR 열기" |
| 새 편집 필드 | `src/domain/overrides.mjs`의 `EDITABLE_FIELDS` 한 줄 + 화면에서 `inlineEdit` 호출 | 메모, 태그, 동물 바꾸기 |
| 새 크기 조절 영역 | `mountSplitter(handle, …)` 호출 한 번 | 보고서/변경사항 탭 높이 |
| 좌석 단위·한 줄 최대 | `public/js/views/office.js`의 `SEATS = { block: 5, maxPerRow: 10 }` | 4석 단위 |

## 5. 기능 설계

### 5.0 하단 버튼 전부 노출

```
[ OK · 1번 진행 ▾ ] [ 채팅방 열기 ]                       ← 1줄: 주 버튼 + 보조 버튼
[컨펌 · 커밋·PR] [요약 만들기] [보류]          [아카이브]  ← 2줄: 작은 버튼, 아카이브는 오른쪽 빨간 글씨
```

1. `actionsFor(session)`의 반환을 `{ primary, secondary, overflow }` → `{ primary, secondary, extra }`로 바꾼다.
   1. `extra`는 2줄에 그리는 버튼 목록. 구분선 항목은 없애고, `kind: 'danger'`는 CSS로 오른쪽에 붙인다.
   2. 상태별로 어떤 버튼이 보이는지는 지금 ⋯ 메뉴 항목과 같다.
2. ⋯ 메뉴는 없앤다. 분할 버튼 ▾(2번·3번 진행)은 남긴다. 메뉴 열림·닫힘·Esc·방향키 코드는 분할 버튼용으로만 유지한다.
3. `handleAction`의 if 사슬을 `ACTION_HANDLERS = { open, summary, confirm, undo, hold, archive }` 표로 바꾼다(`next:N`은 접두어 처리).

### 5.1 책상: 5석 단위, 빈자리 유지

1. 좌석 수 = `(⌊n/5⌋ + 1) × 5`, 빈자리 = `5 − (n mod 5)` (n = 세션 수).

   | 세션 | 0 | 3 | 5 | 7 | 10 | 12 | 20 |
   |---|---|---|---|---|---|---|---|
   | 좌석 | 5 | 5 | 10 | 10 | 15 | 15 | 25 |
   | 빈자리 | 5 | 2 | 5 | 3 | 5 | 3 | 5 |

   1. 요청한 공식을 그대로 따른다. 그래서 자리가 딱 차면 빈 줄 하나(5석)가 새로 생긴다(빈자리가 항상 1석 이상).
2. 한 줄에는 최대 10석이다. 넘으면 줄을 바꾼다. 화면이 좁으면 5석씩 놓는다(§5.2의 `fitGrid`가 5열과 10열 중 책상이 더 크게 보이는 쪽을 고른다).
3. 자리 배정은 유지한다. 한 번 앉은 세션은 같은 자리에 그대로 있다. 좌석 수가 줄어 자리가 없어진 세션만 앞쪽 빈자리로 옮긴다(`assignSeats`, 순수 함수).
4. 서버가 돌려주는 세션 수 한도 `MAX_DESKS`를 10에서 20으로 올린다. 11번째 세션부터 안 보이는 문제를 없앤다.
5. 필터를 켜면(§5.4) 빈자리 없이 해당 세션만 보인다.

### 5.2 크기 조절 (A)

```
┌ 헤더: 오늘의 사무실   [출근 7][결재 대기 3][보류 1]   🗄️ 보관함  🔔 ┐
├ 사무실 ─────────────────────────────────────────────────────┤
│ 🐱 🐶 🐰 🐻 🐧  🦊 🐹 ⬚ ⬚ ⬚          ← 7명 → 10석, 책상 크기 자동 │
╞══════════════════ ↕ 손잡이 (사무실·결재함 높이) ═════════════╡
│ 결재함                                                       │
│ 작업 중 ┆ 결재 대기 ┆ 보류 ┆ 완료        ← ┆ = 칸 폭 손잡이        │
│ [카드]  ┆ [카드] ✋ ┆      ┆             ← 카드 끌어서 놓기(§5.3) │
└─────────────────────────────────────────────────────────────┘
```

1. 사무실과 결재함은 한 화면을 위아래로 나눠 쓴다. 가운데 손잡이 하나로 둘 다 조절한다.
   1. 800px 이상에서는 페이지를 화면 높이에 맞춘다. 결재함 칸 안에서만 스크롤한다.
   2. 800px 미만에서는 지금처럼 위에서 아래로 흐르고, 손잡이는 숨긴다.
2. 결재함 칸 사이의 손잡이 3개로 칸 폭을 조절한다.
   1. 폭은 비율 배열로 저장한다(예: `[1, 1.4, 0.8, 0.8]`).
   2. 손잡이 하나는 이웃한 두 칸 사이에서 폭을 주고받는다. 전체 합은 그대로다(`resizePair`, 순수 함수).
   3. 칸 최소 폭은 160px.
3. 책상 크기는 자동이다. 사무실 영역의 폭·높이와 좌석 수로 5열/10열 중 책상이 가장 크게 들어가는 배치를 고른다(`fitGrid`, 순수 함수).
   1. 책상 한 칸은 56~150px. 최소 크기로도 다 안 들어가면 사무실 안에서 스크롤한다.
   2. `ResizeObserver`로 사무실 크기가 바뀔 때(손잡이 드래그, 패널 열림, 창 크기 변경)마다 다시 계산한다.
   3. 결과는 CSS 변수 `--desk-w`, `--desk-cols`로 넣는다. 말풍선 글자도 `--desk-w`에 비례한다.
4. 모든 손잡이는 공용 `mountSplitter`로 만든다. 지금 패널 폭 손잡이(`panel/resize.js`)도 이걸 쓰도록 옮긴다. 동작은 그대로다.
   1. 드래그, 포커스 후 방향키 ±16px, 더블클릭하면 기본값, `role=separator` + aria 값
   2. 저장: `localStorage`의 `office.panelWidth`(기존), `office.officeHeight`, `office.columns`
   3. 기본값: 사무실 높이 300px, 칸 폭 균등

### 5.3 카드 드래그로 상태 이동 (B)

1. 옮길 수 있는 곳은 서버가 정한다. 세션마다 `moves: [{ to, action }]`를 응답에 싣는다.

   | 놓는 칸 | action | 허용되는 출발 칸 | 하는 일 |
   |---|---|---|---|
   | 보류 | `hold` | 작업 중, 결재 대기, 완료 | 보류 결정 저장 (지금 보류 버튼과 같음) |
   | 완료 | `confirm` | 결재 대기, 보류 | confirm 결정만 저장. **클립보드 복사·채팅 열기 없음**. 커밋·PR은 컨펌 버튼으로 |
   | 결정이 없을 때의 원래 칸 (작업 중 또는 결재 대기) | `undo` | 보류, 완료 | 결정 취소 (지금 보류 해제·컨펌 취소와 같음) |

   1. 규칙 표 `MOVE_RULES`는 `src/domain/board.mjs`에 둔다. 원래 칸은 결정을 뺀 상태(`baseStatus`)로 계산한다.
   2. 작업 중인 카드는 완료로 못 옮긴다. 세션이 아직 돌고 있어서, 다음 hook 이벤트가 오면 어차피 되돌아가기 때문이다.
2. 드래그 중에는 놓을 수 있는 칸에 점선 테두리와 "보류로" "완료로 (상태만)" "되돌리기" 같은 안내를 띄운다. 놓을 수 없는 칸은 흐리게 한다.
3. 놓으면 `POST /api/move/:id?to=<칸>` 호출 → 토스트 → 즉시 다시 불러온다.
4. 드래그 중에는 2초 폴링이 카드를 다시 그리지 않는다. 드래그 중에 DOM이 옮겨지면 드래그가 끊기기 때문이다(⋯ 메뉴가 열려 있을 때와 같은 방식).
5. 브라우저 기본 드래그앤드롭(HTML5 DnD)을 쓴다. 키보드로는 패널 버튼(보류·보류 해제·컨펌)이 같은 일을 한다.

### 5.4 헤더 숫자로 필터

1. 헤더 모양은 그대로 두고, 숫자 칸 3개만 버튼으로 바꾼다.
   1. **출근**: 전체
   2. **결재 대기**: 결재 대기 칸 세션만
   3. **보류**: 보류 칸 세션만
   4. 켜진 버튼만 테두리를 강조한다. 해제는 **출근**을 누른다. 같은 버튼을 다시 눌러도 그대로다(토글 아님).
2. 필터가 켜지면 사무실에는 해당 세션 책상만, 결재함에는 그 칸만 보인다. 한 칸만 남으면 결재함 폭 전체를 쓰고 카드를 여러 줄 격자로 놓는다. 이때는 칸 폭 손잡이를 숨긴다.
3. 숫자는 세션의 `column` 기준으로 센다. "결재 대기" 숫자에 막힘(blocked)이 빠지던 문제도 함께 고쳐진다.
4. 필터 표:
   ```js
   FILTERS = [
     { id: 'all', label: '출근', match: () => true },
     { id: 'pending', label: '결재 대기', match: s => s.column === 'pending', columns: ['pending'] },
     { id: 'hold', label: '보류', match: s => s.column === 'hold', columns: ['hold'] },
   ]
   ```
   1. `columns`를 빼면 모든 칸을 두고 카드만 거른다(예: 프로젝트 필터).
5. 필터 상태는 저장하지 않는다. 새로고침하면 전체로 돌아간다.

### 5.5 세션 이름 변경

1. 패널 위쪽 이름을 클릭(또는 포커스 후 Enter)하면 입력칸으로 바뀐다.
   1. **Enter** 또는 **바깥 클릭**: 저장
   2. **Esc**: 취소. 패널은 닫히지 않는다.
   3. **빈 값**: 앱 원래 이름으로 되돌린다.
   4. 한글 조합 중에 누른 Enter는 저장하지 않는다(`isComposing`).
2. 저장한 이름은 사무실 명패, 결재함 카드, 패널, 보관함, 요약·다음 작업 프롬프트에 모두 쓰인다(모두 `session.title`을 읽기 때문).
3. 대시보드 전용이다. Claude 앱 사이드바 이름은 그대로다. 이름을 바꿨으면 패널 이름에 마우스를 올렸을 때 "앱 이름: …"을 보여준다.
4. 저장소는 이름 전용 파일이 아니라 세션별 **덮어쓰기(override)** 파일로 만든다. 나중에 메모·태그 같은 필드도 같은 파일과 같은 API로 붙인다.
   ```js
   // ~/.claude/office/overrides.json
   { "local_abc": { "title": "결제 모듈 리팩터링", "at": 1790000000000 } }

   // src/domain/overrides.mjs
   EDITABLE_FIELDS = { title: { maxLength: 80 } }
   ```
   1. 입력 정리 규칙: 문자열만 받음, 앞뒤 공백 제거, 줄바꿈·제어문자는 공백으로, 최대 80자, 빈 값은 삭제(원래 이름).
   2. 표에 없는 필드는 거부한다.
5. 화면은 저장 전에 먼저 이름을 바꿔 보여주고(낙관적 갱신), 실패하면 원래대로 되돌리고 토스트를 띄운다. 편집 중에는 폴링이 이름을 덮어쓰지 않는다.

## 6. 인터페이스

### 6.1 HTTP (추가만)

1. `GET /api/sessions`: 세션마다 필드 3개를 추가한다.
   ```json
   { "id": "local_abc", "title": "결제 모듈 리팩터링", "appTitle": "Refactor payment",
     "status": "review", "column": "pending",
     "moves": [{ "to": "hold", "action": "hold" }, { "to": "done", "action": "confirm" }] }
   ```
   1. `title`: 표시용 이름(바꾼 이름이 있으면 그 값). 필드 의미는 그대로다.
   2. `appTitle`: 앱 원래 이름
   3. `column`: `working|pending|hold|done|null` (null = 결재함에 안 보임)
2. `POST /api/move/:id?to=<칸>`

   | 경우 | 응답 |
   |---|---|
   | 정상 (`?to=hold`) | `200 {"ok":true,"action":"hold"}` |
   | 허용 안 되는 칸 (결재 대기 카드 `?to=working`) | `409 {"error":"move not allowed","moves":[…]}` |
   | 없는 세션 | `404 {"error":"unknown session"}` |
   | 다른 Origin | `403 {"error":"bad origin"}` (기존 검사) |

3. `POST /api/edit/:id` (본문 `application/json`, 4KB 이하)

   | 경우 | 요청 본문 | 응답 |
   |---|---|---|
   | 이름 변경 | `{"title":"결제 모듈 리팩터링"}` | `200 {"ok":true,"title":"결제 모듈 리팩터링","appTitle":"Refactor payment"}` |
   | 원래 이름으로 | `{"title":""}` | `200 {"ok":true,"title":"Refactor payment","appTitle":"Refactor payment"}` |
   | 모르는 필드 | `{"color":"red"}` | `400 {"error":"unknown field: color"}` |
   | 형식 오류 | `{"title":123}` | `400 {"error":"title must be a string"}` |
   | JSON 아님 | `not json` | `400 {"error":"bad json"}` |
   | Content-Type 없음 | | `415 {"error":"json only"}` |
   | 4KB 초과 | | `413 {"error":"too large"}` |
   | 없는 세션 | | `404 {"error":"unknown session"}` |

   1. Content-Type을 `application/json`으로 강제하면, 다른 사이트가 사전 확인(preflight) 없이 이 요청을 보낼 수 없다. 기존 Origin 검사 위에 한 겹 더 막는 것이다.

### 6.2 서버 모듈

| 파일 | 레이어 | 내용 |
|---|---|---|
| `src/domain/board.mjs` (새) | domain | `COLUMN_OF`, `columnOf(status)`, `MOVE_RULES`, `movesFor({ status, baseStatus })`, `resolveMove(session, to)` |
| `src/domain/overrides.mjs` (새) | domain | `EDITABLE_FIELDS`, `normalizePatch(raw)` → `{ ok, patch }`/`{ ok:false, error }`, `mergeOverride(current, patch, at)` |
| `src/domain/session-view.mjs` | domain | 인자에 `override`, `moves` 추가 → `title`, `appTitle`, `column`, `moves` |
| `src/sources/overrides.mjs` (새) | sources | `load()`, `save(id, override)` (json-store 사용) |
| `src/usecases/move.mjs` (새) | usecases | `moveSession(session, to)`. `APPLY = { hold, confirm: markConfirmed, undo }`로 기존 `decide.mjs` 함수를 부른다 |
| `src/usecases/edit-session.mjs` (새) | usecases | `editSession(session, raw)` → 정리 → 병합 → 저장 |
| `src/usecases/list-sessions.mjs` | usecases | `baseStatus` 계산, override·moves 전달 |
| `src/http/body.mjs` (새) | http | `readJsonBody(req, { limit })` → 400/413/415 오류 코드 |
| `src/http/routes.mjs` | http | `POST /api/move`, `POST /api/edit` |
| `src/config.mjs` | config | `OVERRIDES_FILE`, `MAX_DESKS = 20` |

### 6.3 프론트 모듈

| 파일 | 내용 |
|---|---|
| `public/js/lib/grid-math.js` (새, 순수) | `seatCount(n, block)`, `assignSeats(prev, ids, total)`, `fitGrid({ count, width, height, colsOptions, min, max })`, `resizePair(fracs, i, dx, total, min)` |
| `public/js/lib/splitter.js` (새) | `mountSplitter(handle, { axis, get, set, commit, reset, step, label })` |
| `public/js/lib/inline-edit.js` (새) | `inlineEdit(el, { value, maxLength, onCommit })` (Enter·blur 저장, Esc 취소, IME 처리) |
| `public/js/lib/storage.js` | `loadPref(key, fallback)` / `savePref(key, v)` 추가. 기존 함수는 이걸 감싸는 형태로 유지 |
| `public/js/views/columns.js` (새, 순수 데이터) | `COLUMNS = [{ id, label, sort?, headerAction? }]` → 결재함 칸 마크업을 이 표로 생성 |
| `public/js/views/filters.js` (새) | `FILTERS` 표 + 헤더 숫자 버튼 생성·클릭 처리 |
| `public/js/views/layout.js` (새) | 사무실·결재함 손잡이, 칸 폭 손잡이, `ResizeObserver` → `fitGrid` |
| `public/js/views/board-dnd.js` (새) | 카드 드래그, 놓을 수 있는 칸 표시, `postMove` |
| `public/js/views/office.js` | 좌석 5석 단위, 빈자리, `renderOffice(sessions, { showEmpty })` |
| `public/js/views/board.js` | `classifyColumn` 삭제 → `session.column` 사용, 한 칸 모드 |
| `public/js/panel/actions.js` | `extra` 반환 (§5.0) |
| `public/js/panel/footer.js` | 2줄 버튼, `ACTION_HANDLERS` 표 |
| `public/js/panel/panel.js` | 이름 인라인 편집 |
| `public/js/panel/resize.js` | `mountSplitter` 사용 (`clampWidth` 그대로) |
| `public/js/store.js` | `view = { filter: 'all' }`, `drag = { id: null }` |
| `public/js/api.js` | `postMove(id, to)`, `postEdit(id, patch)` |

## 7. 테스트

| 파일 | 확인 |
|---|---|
| `test/unit/grid-math.test.mjs` (새) | 좌석 수 표(§5.1), 자리 유지·축소 시 이동, 5/10열 선택·한 줄 최대 10, 최소 크기 넘침, 칸 폭 합 유지·최소 폭 |
| `test/unit/board.test.mjs` (새) | 상태→칸, 규칙 표(§5.3) 전 경우, 작업 중→완료 거부, 클라이언트 `COLUMNS` id가 서버 칸 id와 같은지 |
| `test/unit/overrides.test.mjs` (새) | 공백·줄바꿈·제어문자·80자 자르기, 빈 값 삭제, 모르는 필드 거부 |
| `test/unit/actions.test.mjs` | `extra` 형태로 갱신 |
| `test/integration/office.test.mjs` | `/api/move` 보류→완료→되돌리기 왕복, 409, `/api/edit` 변경·복구·400·415·413, `/api/sessions`의 `title`·`appTitle`·`column`·`moves` |
| 브라우저 (데모 서버 7770) | 손잡이 3종, 카드 드래그, 필터, 이름 변경(한글 Enter), 좌석 5→10→15, 좁은 화면 |

## 8. 작업 순서 · 병렬화

1. 1단계: 서브에이전트 3개 병렬 (파일이 겹치지 않게 나눔)
   1. 백엔드: §6.2 전부 + 단위·통합 테스트
   2. 화면 배치: `grid-math`, `splitter`, `layout.js`, `office.js`, `resize.js`, `storage.js`, `index.html`의 stage 구조, base·office·board CSS의 배치 부분
   3. 패널: `actions.js`, `footer.js`, `inline-edit.js`, `panel.js`, `panel.css`, `api.js`
2. 2단계 (1단계 결과를 씀): `columns.js`, `filters.js`, `board-dnd.js`, `board.js`, `main.js`, `store.js`, 헤더 숫자·칸 마크업, 드래그 CSS
3. 3단계: 통합 검증(테스트, 메트릭, 브라우저, 실제 데이터), README 한/영, 이 문서 상태 갱신, 스크린샷
4. 단계마다 테스트가 통과하면 커밋한다. 문제가 생기면 그 커밋만 revert한다.

## 9. 롤백

1. 기능마다 커밋을 나누므로 커밋 단위로 되돌린다.
2. 데이터
   1. `decisions.json` 형식은 그대로다(드래그도 기존 결정을 쓴다).
   2. 새 파일은 `overrides.json` 하나다. 지우면 모든 이름이 앱 이름으로 돌아간다.
   3. 새 `localStorage` 키 2개는 지워도 기본값으로 시작한다.
3. API는 추가만 했으므로, 되돌려도 기존 화면과 테스트는 영향이 없다.

## 10. 정한 기본값 (바꾸려면 알려주세요)

1. 좌석 5석 단위, 한 줄 최대 10석, 자리가 딱 차면 빈 줄 하나 추가 (요청한 공식 그대로)
2. `MAX_DESKS` 10 → 20
3. 필터 중에는 빈자리 없음. 새로고침하면 필터 해제
4. 헤더 숫자는 모양 그대로 버튼으로만 바꿈. 해제는 "출근"(토글 아님)
5. 완료 칸에 놓으면 상태만 바뀜 (커밋·PR 없음)
6. 작업 중 카드 → 완료 불가
7. 이름은 대시보드 전용, 최대 80자, 빈 값이면 원래 이름
8. 사무실 기본 높이 300px, 칸 최소 폭 160px, 책상 56~150px

## 11. 구현하며 달라진 점

1. 인터페이스
   1. `resolveMove(moves, to)`: 세션 전체 대신 `session.moves`만 받는다.
   2. `mountSplitter(handle, { axis, label, step, onStart, onMove(deltaPx), onEnd, onReset })`: 값 대신 이동량(delta)을 넘긴다. 패널 폭(값 하나)과 칸 폭(비율 배열)을 같은 부품으로 다루기 위해서다.
   3. `actionsFor`의 `extra`에서 구분선 항목을 없앴다. 아카이브를 오른쪽에 붙이는 것은 CSS가 맡는다.
2. 동작
   1. 필터로 일부만 보일 때는 `fitGrid` 열 후보를 인원 수로 자른다. 7명이면 넓은 화면에서 7열 한 줄이 된다.
   2. 필터 중에는 자리 배정을 건드리지 않는다. 필터를 풀면 모두 원래 자리로 돌아온다.
   3. 사무실 높이는 사용자가 정한 값과 화면에 적용한 값을 따로 둔다. 창이 작아지면 적용 값만 줄고, 다시 커지면 원래 높이로 돌아온다.
   4. 카드를 놓으면 서버 응답 전에 새 칸으로 먼저 옮겨 보여준다(원래 칸으로 잠깐 튀는 현상 방지). 서버가 거부하면 바로 이어지는 폴링이 되돌린다.
   5. `/api/edit`는 세션을 찾기 전에 본문을 먼저 검사한다. 없는 세션에 잘못된 본문을 보내면 404가 아니라 400/413/415가 나온다.
   6. 이름 정리에서 지우는 제어문자 범위를 C1(`\u0080-\u009f`)까지 넓혔다.
   7. 책상 크기는 화면을 그리는 시점(`requestAnimationFrame`)에 계산한다. 탭이 뒤에 있으면 멈췄다가 다시 보이는 순간 반영된다.
3. 검증 중 고친 것
   1. 책상 그림(svg)이 inline 요소라 글자 기준선 여백 3.5px이 붙어 사무실이 넘쳤다. `display:block`으로 고쳤다(`55cb4e3`).
   2. `MAX_DESKS`가 20이 되면서 통합 테스트의 세션 수 단언이 앞 테스트가 남긴 세션까지 세게 됐다. `local_*` 세션만 세도록 바꿨다.
4. 남은 것
   1. 칸 2~3개만 남기는 필터는 아직 없다. 생기면 `layout.js`의 칸 폭 계산이 보이는 칸만 다루도록 바꿔야 한다.
   2. 실제 마우스 드래그는 브라우저 패널 도구로 재현할 수 없어서, 드래그 이벤트를 직접 만들어 확인했다. 실제 마우스 확인은 사용자 테스트 몫이다.
6. 후속: 🗄️ 보관함 버튼에 놓으면 아카이브 (§4 확장 예시를 실제로 적용)
   1. 서버: `MOVE_RULES`에 `{ to: 'archive', action: 'archive' }` 한 줄, `APPLY`에 `archive` 한 줄
   2. 화면: 드롭 대상을 칸 전용에서 `data-drop` 속성이 붙은 요소 전체로 넓힘. 보관함 버튼에 `data-drop="archive"`, `MOVE_HINT`·`MOVE_TOAST`에 한 줄씩
   3. 열려 있던 패널이 그 세션이면 아카이브 버튼처럼 패널을 닫는다
5. 테스트: 48개 → 77개. 메트릭 4개 통과(`/api/sessions` p95 3.3ms).
