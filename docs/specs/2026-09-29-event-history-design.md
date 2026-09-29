# 설계: hook 이벤트 이력 (append-only)

- 작성일: 2026-09-29
- 상태: 구현 완료 (2026-09-29, 브랜치 `feat/product-review-improvements`)
- 근거: `docs/product-review-20260929.md` 4.3 개선안 5, 4.2-2 (last-event 상태 모델)

## 1. 목적

1. 세션당 마지막 이벤트 1건만 남는 구조(`state/<id>.json` 덮어쓰기)에 **이력**을 더해 시계열 값을 계산한다.
2. 이력으로 만드는 값은 두 개로 시작한다.
   1. 결재 대기 진입 시각 `pendingSince`: 결재 대기 칸을 오래 기다린 순으로 정렬하고 카드에 "n분째 대기"를 표시
   2. 지난 턴 소요 시간 `turnMs`: `UserPromptSubmit` → `Stop`
3. 기존 동작은 그대로 둔다. 이력이 없거나 깨져도 지금과 같은 화면이 나와야 한다.

## 2. 사실 (현재 코드)

| 항목 | 사실 | 근거 |
|---|---|---|
| hook 기록 | 이벤트마다 `state/<id>.json`을 tmp 파일 + rename으로 덮어쓴다 | `hooks/report.mjs:27-38` |
| 무시하는 이벤트 | `Stop` 직후의 `Notification`(입력 대기 알림)은 기록하지 않는다 | `hooks/report.mjs:24-25` |
| 상태 | 마지막 이벤트 1건으로 working/blocked/review/question을 정한다 | `src/domain/status.mjs:6-14` |
| 카드 경과 시간 | `Date.now() - eventAt` (마지막 이벤트 시각) | `public/js/views/board.js:55` |
| 결재 대기 정렬 | blocked → review → question 순위만. 같은 순위 안에서는 poll 목록 순서(최신순) | `public/js/views/columns.js:7-17` |

`pendingSince`는 대부분 `eventAt`과 같다. 달라지는 경우는 사용자 입력 없이 같은 이벤트가 이어질 때다(권한 요청 `Notification`이 여러 번, Stop hook이 턴을 이어가게 해서 `Stop`이 여러 번). 이때 `eventAt`은 마지막 것이라 대기 시간이 짧게 보이고, 이력은 처음 멈춘 시각을 준다. `turnMs`는 이력 없이는 계산할 수 없다(시작 이벤트가 덮어써짐).

## 3. 스키마

파일: `~/.claude/office/events/<cli session id>.jsonl` (hook의 `session_id`, `state/`와 같은 이름 규칙)

```json
{"event":"UserPromptSubmit","at":1759132800000}
{"event":"Notification","at":1759132860000}
{"event":"Stop","at":1759133100000}
```

| 필드 | 타입 | 뜻 |
|---|---|---|
| `event` | `'UserPromptSubmit' \| 'Notification' \| 'Stop'` | hook 이벤트 이름 |
| `at` | number (ms) | hook 실행 시각. `state/<id>.json`의 `at`과 같은 값 |

1. `state/`에 쓰는 이벤트만 append한다(같은 필터). 그래서 이력의 마지막 줄 = 현재 state.
2. message·cwd·경로는 넣지 않는다. 이력에서 쓰는 값이 아니고, 파일을 작게 유지한다.

## 4. 파생값 (순수 함수, `src/domain/timeline.mjs`)

| 값 | 계산 | 이력이 없거나 안 맞을 때 |
|---|---|---|
| `pendingSince` | 결재 대기(`column === 'pending'`)일 때만. 이력 끝에서부터 현재 이벤트와 **같은 이벤트가 이어지는 구간**의 첫 `at` | 마지막 줄의 `at`이 `state.at`과 다르면(이력 누락) `state.at` |
| `turnMs` | 마지막 `Stop`의 `at` − 그 `Stop`을 부른 프롬프트 묶음(앞 `Stop` 이후의 `UserPromptSubmit`들) 중 첫 `at`. 프롬프트 없이 이어진 `Stop`(Stop hook이 턴을 계속함)은 같은 턴으로 본다 | 마지막 `Stop` 앞에 프롬프트가 없으면 `null` |

화면:

1. 결재 대기 칸: `pendingSince` 오름차순(오래 기다린 카드가 위). 같으면 기존 순위(blocked → review → question). 정렬 키가 고정 시각이라 poll마다 카드 순서가 흔들리지 않는다.
2. 카드 메타 줄 끝에 ` · n분째 대기`.
3. 패널 부제에 `지난 턴 n분`.

## 5. 보존 · 용량

| 항목 | 값 | 근거 |
|---|---|---|
| 한 줄 크기 | 약 45~55 byte | 스키마 (§3) |
| 세션 하나 | 턴 200개 × 이벤트 2~3개 ≈ 30KB | 추정 |
| 읽는 양 | 파일 끝 64KB만 (`EVENTS_TAIL_BYTES`), 크기+mtime 캐시. 보드에 앉은 세션(최대 20석)만 읽는다 | `src/config.mjs`, `src/sources/events.mjs` |
| 삭제 | 자동 삭제 없음. `rm -rf ~/.claude/office/events`는 언제든 안전(값이 `eventAt`/`null`로 돌아갈 뿐) | §6 |

## 6. 실패 · 롤백

1. hook: append는 state 기록 **뒤에** 별도 `try`로 한다. append가 실패해도 state는 이미 써졌고, 전체가 `exit 0`이다.
2. 서버: 파일이 없거나 줄이 깨지면 그 줄을 버린다(`transcripts.mjs`와 같은 방식). 64KB 창 앞에서 잘린 첫 줄도 같다.
3. 롤백: `hooks/report.mjs`의 append 블록만 지우면 새 이력이 안 쌓이고, `pendingSince`는 `eventAt`, `turnMs`는 `null`이 된다. API 필드는 추가만 했으므로 클라이언트는 그대로 동작한다.

## 7. 하지 않은 것

1. 토큰 합계(transcript `message.usage`): tail 캐시는 끝 256KB만 보므로 세션 전체 합계가 아니다. 제대로 하려면 파일 전체를 증분으로 읽고 같은 `message.id`가 content 블록마다 반복되는 것을 중복 제거해야 한다. 필요해지면 `src/sources/transcripts.mjs`에 (크기 오프셋, 누적값) 캐시로 추가한다.
2. 결재 대기 → 결정까지 걸린 시간: 결정은 `decisions.json`에 세션당 1건만 남는다. 필요하면 결정도 같은 파일에 append한다.
