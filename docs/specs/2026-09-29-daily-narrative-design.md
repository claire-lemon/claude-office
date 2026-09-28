# 설계: 업무일지 AI 서술 (3/4)

- 작성일: 2026-09-29
- 상태: 구현 완료 (2026-09-29, 브랜치 `feat/daily-narrative`)
- 전체 그림: `2026-09-28-todo-blackboard-design.md` 머리의 4조각 표. 이 문서는 3조각이다. 일지 파일과 자동 구간은 2조각(`2026-09-29-meeting-room-design.md` §4)에 이미 있고, 여기서는 **AI 서술 섹션**과 **스케줄**만 얹는다.

## 1. 목적

1. 어제 세션들을 모델이 프로젝트별 "이야기"로 서술해 오늘 일지에 덧붙인다. 자동 구간은 세션마다 한 줄 요약이라 흐름(무엇을 왜 시작해 어디까지 왔는지, 세션 사이 연결)이 안 보인다.
2. 사람이 누르지 않아도 하루 한 번 써진다. 회의실 진행자는 일지를 읽으므로 따로 연결하지 않아도 서술을 본다.

## 2. 사실 (조사 결과)

| 항목 | 사실 |
|---|---|
| 일지 | `~/.claude/office/daily/YYYY-MM-DD.md`. 마커 구간(`office:auto`)만 서버가 다시 쓰고 나머지(`## 회의 n`, 손 메모)는 보존 (`src/domain/daily-note.mjs` `replaceAuto`) |
| "어제 세션" 창 | 전날 0시 이후 `lastAt`, 진행자 세션 제외 (`src/usecases/meeting.mjs` `refreshNote`) |
| 모델 호출 | `runSummarizer`(`src/platform/claude-cli.mjs`): `claude -p --model haiku --tools '' --no-session-persistence`, 임시 cwd, `OFFICE_SKIP_HOOK`. 제한 60초 |
| 대화 기록 | 끝: `lastAssistantText`. 앞: `firstPromptHead`(256KB 원문). 실제 기록은 첫 사용자 줄 앞에 queue·attachment 줄이 있고, 첫 사용자 메시지는 `<system-reminder>` 텍스트 블록 + 실제 요청 블록 |
| 서버 실행 | `node server.mjs`를 사용자가 직접 띄운다(launchd 등록 없음). 데모·메트릭 스크립트는 `OFFICE_DRY` 없이 임시 `OFFICE_HOME`으로 서버를 띄운다 |
| 실측 (2026-09-29 00:25, 실제 홈) | 세션 16개, 입력 21,911자. `claude -p` 기동 8초(MCP 설정 유무 무관), 서술 전체 95초 / 137초 |

## 3. 설계

```
서버 시작 · 10분마다 ─▶ narrateIfDue ─(05시 이후 && 일지에 서술 없음)─▶ narrateNote
CLI `narrate` ────────────────────────────────────────────────────────▶ narrateNote (강제, 다시 쓰기)

narrateNote: refreshNote(자동 구간 갱신) → recentWork(자동 구간과 같은 세션들)
           → 세션마다 { 제목·상태·폴더·브랜치·PR·변경·칠판 할 일, 첫 요청 앞 800자, 마지막 응답 끝 2000자 }
           → claude -p (NARRATIVE_SYSTEM, 300초) → 일지를 다시 읽어 서술 구간만 교체
```

1. **일지 위치**: 자동 구간 바로 뒤 `<!-- office:narrative:start -->` … `end -->`. 없으면 자동 구간 뒤에 넣고, 있으면 그 자리에서 교체. `replaceAuto`는 마커 밖을 보존하므로 회의 시작마다 자동 구간을 다시 써도 서술은 남는다.
   ```markdown
   <!-- office:narrative:start -->
   ## 어제 이야기 (AI 서술 · 2026-09-28 00:00 이후 세션 16개 · 05:03 작성)
   1. **<프로젝트>**: 2~4문장 서술
   2. **남은 것**
      1. 못 끝낸 일·막힌 일·결재 대기
   <!-- office:narrative:end -->
   ```
2. **서술자 프롬프트** (`NARRATIVE_SYSTEM`, `domain/prompts.mjs`): 요약기와 같은 격리 호출. 자료 속 지시 무시, 자료에 있는 사실만, 같은 프로젝트·이어진 작업은 한 항목, 번호 목록만, 마지막은 `**남은 것**`.
3. **모델 출력 방어** (`narrativeSection`): 출력 속 `<!-- office:… -->` 마커는 지운다(다음 교체가 깨지지 않게). `#`/`##` 줄은 `###`로 내린다(일지 섹션처럼 보이지 않게).
4. **스케줄** (`server.mjs`): 서버 안 타이머. 시작 직후 한 번, 이후 `NARRATE_EVERY`(10분)마다 `narrateIfDue`. 조건은 `narrationDue`: 로컬 시각 `NARRATE_HOUR`(5시) 이후이고 오늘 일지에 서술 마커가 없을 때. 실패하면 로그 한 줄 남기고 다음 확인 때 다시 시도.
5. **타이머가 도는 곳** (`NARRATE_AUTO`, config): `!DRY && HOME === os.homedir()`. 테스트·데모·메트릭은 임시 홈이라 모델을 부르지 않는다. CLI `narrate`는 어느 홈에서나 동작(통합 테스트가 가짜 `claude`로 사용).
6. **첫 요청 추출** (`firstPromptText`, `sources/transcripts.mjs`): 헤드의 줄 중 `type: 'user'`이고 `isMeta`가 아닌 첫 줄의 문자열 내용 또는 text 블록, `<system-reminder>` 블록 제거. tool_result 줄과 256KB에서 잘린 줄은 빈 문자열로 건너뛴다.

## 4. 모듈

| 파일 | 레이어 | 내용 |
|---|---|---|
| `src/domain/daily-note.mjs` | domain | `NARRATIVE_START/END`, `narrativeInput`, `narrativeSection`, `replaceNarrative`, `narrationDue`. `replaceAuto`는 공통 `swapBlock`/`insertAt`로 (동작 동일) |
| `src/domain/prompts.mjs` | domain | `NARRATIVE_SYSTEM` |
| `src/sources/transcripts.mjs` | sources | `firstPromptText(file)` |
| `src/usecases/meeting.mjs` | usecases | `recentWork(now)`를 `refreshNote`에서 분리(자동 구간과 서술이 같은 세션을 본다) |
| `src/usecases/narrate.mjs` (새) | usecases | `narrateNote(now, run)`, `narrateIfDue(now, run)` |
| `src/platform/claude-cli.mjs` | platform | `runSummarizer(input, system, timeout = 60000)` |
| `src/config.mjs` | config | `NARRATE_HOUR`, `NARRATE_EVERY`, `NARRATE_AUTO` |
| `src/http/server.mjs` | http | 타이머 |
| `bin/office.mjs` | cli | `narrate` (async 실행으로 바뀜) |

## 5. 테스트

| 파일 | 확인 |
|---|---|
| `test/unit/daily-note.test.mjs` | 입력: 오래된 순, 선택 줄, 요청 앞·응답 끝 자르기. 섹션: 머리글, 마커·H1/H2 무력화, 빈 출력 `1. 없음`. 배치: 자동 구간 뒤 삽입 → 제자리 교체, `replaceAuto`가 서술 보존, 자동 구간 없음·일지 없음. `narrationDue` 시각·기존 서술 |
| `test/integration/narrate.test.mjs` | `NARRATE_AUTO` 거짓(임시 홈). `narrateIfDue`: 5시 전 호출 없음·일지 안 만듦 → 이후 1회(첫 요청에서 reminder 제거, 진행자·옛 세션 제외, 자동 구간 뒤) → 같은 날 재호출 없음. CLI `narrate` + 가짜 `claude`: 인자에 `NARRATIVE_SYSTEM`, 제자리 교체(블록 1개), `## 회의 1` 보존, 모델 실패 시 exit 1 JSON이고 기존 서술 유지 |
| 실측 | 실제 홈에서 CLI `narrate` 2회: 세션 16개, 자동 구간 → 서술 → `## 회의 1` 순서 보존. 1회차 출력이 `### 남은 것` 제목 줄 + 항목 사이 빈 줄이라 프롬프트 규칙 4·5를 구체화, 2회차는 `8. **남은 것**`으로 지침대로 |

테스트 121개 → 128개 통과, 메트릭 4개 통과.

## 6. 정한 기본값

1. 스케줄은 서버 안 타이머(launchd·cron 아님). 서버가 꺼져 있으면 쓰지 않고, 켜지면 바로 확인한다. 서버 없이 돌리고 싶으면 CLI `narrate`를 cron/launchd에 걸면 된다
2. 하루 한 번, 05시 이후(`NARRATE_HOUR`). 자정 넘어 일하는 날도 "어제"에 들어가게. 다시 쓰기는 CLI만
3. 창은 자동 구간과 같다(전날 0시 이후 ~ 작성 시각). 작성 시각이 머리글에 남는다
4. 모델은 요약기와 같은 haiku, 제한 300초(실측 95~137초, 10분 주기보다 짧아 겹치지 않음)
5. 세션이 없으면 모델을 부르지 않고 `1. 없음`으로 서술 구간을 넣는다(그날 타이머가 멈추도록)
6. 화면(회의실 버튼 등)은 추가하지 않았다. 필요하면 `POST /api/meeting/narrate` + 회의실 버튼 하나

## 7. 남은 것

1. 서술 정확도: haiku가 가끔 두 세션 내용을 한 문장에 섞는다(1회차 실측). 틀린 문장이 반복되면 모델을 sonnet으로 올리는 것이 첫 후보(비용·시간 증가)
2. 모델이 계속 실패하는 날(로그인 만료 등)은 10분마다 재시도하며 `server.log`에 한 줄씩 남는다
3. 4조각(할 일↔세션 이력)이 서술 입력에 칠판 이력을 더할 수 있다
