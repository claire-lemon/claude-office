# 설계: 회의 진행자 읽기 허용 규칙

- 작성일: 2026-09-29
- 상태: 구현 완료 (2026-09-29, 브랜치 `feat/moderator-permission-rules-ebe5c6`)
- 근거: 오늘의 할 일 #todo-fou1o8 "진행자 권한 허용 규칙을 설정에 넣을지 정하기" (회의 때마다 허용 클릭 반복)

## 1. 목적

1. 회의 진행자 세션이 쓰는 도구와 경로를 확인한다.
2. 허용 규칙을 설정에 넣을지 정한다. 넣는다면 다음 회의가 클릭 없이 진행되게 한다.

## 2. 조사 방법

1. 오늘(2026-09-29) 진행자 세션 3개의 대화 기록에서 `tool_use`를 모두 뽑음 (`~/.claude/projects/*daily-scrum-2026-09-29-*/*.jsonl`)
2. 같은 세션의 앱 메타데이터(`local_*.json`)에서 `cwd`, `originCwd`, `permissionMode` 확인
3. 설정 파일 위치별 적용 범위 확인 (`~/.claude/settings.json`, `~/.claude/office/.claude/settings.json`)

## 3. 사실

| 항목 | 사실 | 근거 |
|---|---|---|
| 진행자가 쓴 도구 | `Read`만. 세션 3개, 호출 7번. Bash·Write·Edit·웹 호출 없음 | 대화 기록 `tool_use` |
| 읽은 경로 | `~/.claude/office/CLAUDE.md`(지침), `~/.claude/office/daily/2026-09-29.md`(일지, `offset` 읽기 1번 포함) 두 개뿐 | 대화 기록 `tool_use.input.file_path` |
| 지침이 허용하는 읽기 | 지침 파일, 프롬프트의 `오늘 일지:` 파일, 사용자 채팅. 명령·쓰기·웹 금지 | `src/domain/meeting.mjs:34-46` (`facilitatorGuide`의 역할·금지) |
| 진행자 세션 cwd | 매번 새 워크트리: `~/.claude/office/.claude/worktrees/daily-scrum-…` 2개, `~/.claude/worktrees/daily-scrum-…` 1개 | 앱 `local_*.json`의 `cwd` |
| 워크트리가 생기는 이유 | 홈 폴더(`/Users/kang-yeeun`)가 git 레포라 `~/.claude/office`도 그 안에 있음. 앱이 폴더를 레포로 보고 세션마다 워크트리를 만든다 | `git -C ~/.claude/office rev-parse --show-toplevel` → `/Users/kang-yeeun` |
| 권한 모드 | `auto` 2개, `bypassPermissions` 1개 | 앱 `local_*.json`의 `permissionMode` |
| 클릭이 뜨는 이유 | 지침·일지가 세션 작업 폴더(워크트리) 밖에 있어 `Read`가 작업 폴더 밖 읽기가 됨. 앱이 폴더를 무시하고 scratch 작업 공간에 연 경우도 같음 | 위 cwd, `docs/specs/2026-09-29-meeting-room-design.md` §11 4.1 |
| 프로젝트 설정으로 안 되는 이유 | 세션 cwd가 `~/.claude/office`가 아니라 워크트리·scratch라 `~/.claude/office/.claude/settings.json`이 읽힌다고 보장할 수 없음 | 위 cwd |
| 사용자 설정 | `~/.claude/settings.json`은 cwd와 상관없이 모든 세션에 적용. `install.mjs`가 이미 백업 후 hooks를 넣는 파일 | `install.mjs` |
| 규칙 문법 | 읽기 경로 규칙은 `Read(path)`, `//`로 시작하면 절대 경로 | Claude Code 설정 문서 (update-config 스킬) |

## 4. 결정

1. 넣는다. `node install.mjs`가 `~/.claude/settings.json`의 `permissions.allow`에 두 줄을 더한다.
   ```json
   "Read(//Users/<you>/.claude/office/CLAUDE.md)",
   "Read(//Users/<you>/.claude/office/daily/**)"
   ```
   1. 범위는 진행자가 실제로 읽는 두 곳뿐. `state/`, `events/`, `decisions.json`, `todos.json`은 넣지 않음
   2. 경로는 `config.mjs`의 `GUIDE_FILE`, `DAILY_DIR`에서 만든다(`OFFICE_HOME` 테스트 홈도 그대로 맞음)
   3. 다시 실행해도 한 번만 들어가고, 다른 규칙은 그대로 둔다. `--uninstall`은 이 두 줄만 뺀다
2. 사용자 설정이라 다른 세션도 이 두 곳은 묻지 않고 읽는다. 둘 다 이 대시보드가 쓰는 로컬 요약 파일이고 쓰기 권한은 주지 않는다.
3. 별도 설정 화면은 만들지 않는다.
   1. 켜고 끌 값이 이 규칙 하나이고, 설치 스크립트가 이미 같은 파일을 관리함
   2. 서버가 쓰는 곳은 `~/.claude/office/` 하나라는 원칙(README 구조)을 깨게 됨
   3. 사용자가 고를 설정이 두 개 이상 생기면 그때 만든다

## 5. 적용 방법

1. 이 브랜치가 main에 합쳐진 뒤 원래 체크아웃(`~/claude-office`)에서 `node install.mjs` 한 번 실행
   1. 워크트리에서 실행하면 hooks 경로가 그 워크트리로 바뀌므로 원래 체크아웃에서 실행
2. 이미 열린 진행자 세션은 설정을 다시 읽지 않을 수 있음. 다음 회의(새 세션)부터 확인

## 6. 남은 것

1. 실제 회의에서 클릭 없이 지침·일지를 읽는지는 다음 회의에서 확인 (auto 모드에서 허용 규칙이 작업 폴더 밖 읽기 확인보다 먼저 적용되는지는 코드로 확인하지 못함)
2. 홈 폴더가 git 레포라 회의마다 홈 레포에 `daily-scrum-*` 워크트리·브랜치가 쌓인다(오늘 3개). 이 규칙과는 별개 문제
