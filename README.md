# Claude Office

**한국어** | [English](README.en.md)

병렬로 돌리는 Claude Code(데스크톱 앱) 세션을 픽셀 오피스로 관제하고, 결재함(칸반)에서 보고서·diff를 확인한 뒤 컨펌하는 로컬 대시보드.
설계: [`docs/specs/2026-09-25-claude-office-design.md`](docs/specs/2026-09-25-claude-office-design.md)

![Claude Office — 픽셀 오피스와 결재함 (데모 데이터)](docs/images/office-light.png)

| 상세 패널 · 보고서 | 상세 패널 · 변경사항 |
|---|---|
| ![보고서 탭: 결재 보고와 다음 작업](docs/images/panel-report.png) | ![변경사항 탭: 워크트리 diff](docs/images/panel-diff.png) |

- 의존성 0개 (Node 22 표준 라이브러리 + `git`)
- `127.0.0.1:7777` 전용
- macOS 전용 (앱 로컬 파일, `open`, `pbcopy` 사용). 호환성·검증 상태: [`docs/research/2026-09-28-compat-and-verification.md`](docs/research/2026-09-28-compat-and-verification.md)

## 구조

```mermaid
flowchart TB
    subgraph APP["Claude 데스크톱 앱"]
        S["작업 세션들<br/>워크트리마다 하나"]
        NEW["새 세션 입력창"]
    end

    HOOK["hooks/report.mjs<br/>UserPromptSubmit · Notification · Stop"]

    subgraph READ["서버가 읽는 데이터"]
        ST["~/.claude/office/state/*.json<br/>세션별 마지막 이벤트"]
        META["앱 세션 메타데이터<br/>제목 · 브랜치 · PR · 딥링크"]
        TR["대화 기록 .jsonl<br/>마지막 응답 · 결재 보고"]
        GIT["워크트리 git<br/>diff · 브랜치 · 프로젝트"]
    end

    SRV["server.mjs + lib.mjs<br/>127.0.0.1:7777"]
    DEC[("~/.claude/office/decisions.json<br/>컨펌 · 보류 · 아카이브")]
    UI["브라우저<br/>픽셀 오피스 · 결재함<br/>상세 패널 · 보관함"]

    S -- "훅 이벤트" --> HOOK --> ST
    ST --> SRV
    META --> SRV
    TR --> SRV
    GIT --> SRV
    SRV <--> DEC
    SRV -- "/api/sessions 2초마다" --> UI
    UI -- "컨펌 · 보류 · 아카이브 · OK" --> SRV
    SRV -. "컨펌 · 답장<br/>앱 모드: 바로 전송<br/>웹 모드: ⌘V, Enter" .-> S
    SRV -. "OK → 새 세션 딥링크<br/>(Enter)" .-> NEW
```

- 세션 상태는 hooks가 남긴 이벤트로, 제목·브랜치·딥링크는 앱 파일에서, 변경사항은 각 워크트리의 git에서 읽는다.
- 서버가 쓰는 곳은 `~/.claude/office/` 하나다. 앱 데이터와 세션 파일은 읽기만 한다.
- 세션에 무언가를 보낼 때(컨펌, OK)는 마지막 Enter를 항상 사용자가 누른다.

## 먼저 데모로 보기 (실제 설정 안 건드림)

```bash
node scripts/demo.mjs public 7770
```

가짜 세션 10개가 8초마다 상태를 바꾼다. `http://127.0.0.1:7770`

## 실제로 쓰기

1. hooks 설치 (`~/.claude/settings.json` 백업 후 `UserPromptSubmit` / `Notification` / `Stop` 추가)
   ```bash
   node install.mjs
   ```
2. 보고 규칙 추가: [`CLAUDE-report-rule.md`](CLAUDE-report-rule.md) 내용을 `~/.claude/CLAUDE.md` 끝에 붙인다.
3. 서버 실행 후 `http://127.0.0.1:7777`
   ```bash
   node server.mjs
   ```
4. 앱에서 새 세션에 작업 지시 → 사원이 타이핑 → 끝나면 "보고드려요" → 카드 클릭 → 보고서/변경사항 확인 → 채팅방 열기 또는 컨펌.

특정 세션 패널을 바로 여는 주소: `http://127.0.0.1:7777/?open=<세션 id>` (변경사항 탭은 `&tab=diff`).

hooks는 설치 **이후** 시작된 턴부터 잡힌다. 설치 전 세션은 24시간 이내 활동분만 회색(상태 미상)으로 보인다.

## 실행 방법: 웹 모드 · 앱 모드

| | 웹 모드 | 앱 모드 |
|---|---|---|
| 실행 | `node server.mjs` | `~/Applications/Claude Office.app` 더블클릭 (처음 한 번 `node scripts/make-app.mjs`로 생성) |
| 대시보드 · 보고서 · diff · 보류 · 보관함 | ✅ | ✅ |
| 컨펌 | 지시문 복사 + 채팅방 열기 → ⌘V, Enter | **바로 전송** |
| 답장 입력칸 | 없음 | 있음. Enter로 **바로 전송** (Shift+Enter 줄바꿈) |
| 필요한 권한 | 없음 | 손쉬운 사용 (Claude Office), 첫 전송 때 자동화 허용 |
| 터미널 창 | 켜둬야 함 | 필요 없음 (백그라운드 실행) |

### 앱 모드 설정 (한 번만)

1. 앱 만들기
   ```bash
   node scripts/make-app.mjs
   ```
2. 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → `+` → ⌘⇧G → `~/Applications/Claude Office.app` → 켜기
3. `~/Applications/Claude Office.app`을 더블클릭. 서버가 백그라운드로 켜지고 대시보드가 열린다. 이미 켜져 있으면 대시보드만 연다.
4. 첫 바로 전송 때 "Claude Office이(가) System Events / Claude을(를) 제어하려고 합니다"가 뜨면 **허용**
5. (선택) 시스템 설정 → 일반 → 로그인 항목에 Claude Office를 추가하면 로그인할 때 자동으로 켜진다.

- 앱을 다시 만들면(`make-app.mjs` 재실행) macOS가 새 앱으로 본다. 손쉬운 사용에서 기존 항목을 지우고 다시 추가해야 한다.
- 서버 로그: `~/.claude/office/server.log`. 끄기: `lsof -ti tcp:7777 -sTCP:LISTEN | xargs kill`

### 바로 전송이 엉뚱한 채팅에 가지 않는 이유

1. 보낼 내용을 클립보드에 넣고 해당 채팅을 연다.
2. 앱의 세션 파일에서 그 세션의 `lastFocusedAt`이 방금 갱신됐는지(= 앱이 그 채팅으로 이동했는지) 확인한다. 이미 그 채팅이 떠 있었다면 가장 최근에 본 세션인지 확인한다.
3. 확인되고 Claude 앱이 맨 앞에 있을 때만 ⌘V, Enter를 누르고, 원래 클립보드를 되돌린다.
4. 확인이 안 되면 아무 키도 누르지 않는다. 내용은 클립보드에 남아 직접 ⌘V, Enter 하면 된다.

## 컨펌과 다음 작업

1. **컨펌 · 커밋·PR**을 누르면 세션에 "커밋 → PR → 다음 작업 추천" 지시가 간다. 앱 모드는 바로 전송, 웹 모드는 복사 + 채팅방 열기 후 ⌘V, Enter.
2. 세션이 `### 다음 작업`이 담긴 보고를 올리면 **OK · 1번 진행**(또는 N번 진행)을 누른다. 새 세션 입력창이 채워진 채 열리고, Enter만 누르면 된다.

## 보류 · 아카이브 · 보관함

- **보류**: 아무 동작 없이 결재함의 보류 칸으로 옮긴다. 24시간이 지나도 보드에 남는다.
- **아카이브**: 사무실과 결재함에서 뺀다. 완료 칸 헤더의 **모두 아카이브**로 한 번에 비울 수 있다.
- **🗄️ 보관함**(헤더): 아카이브한 작업을 작업 이름 · 날짜 · 한 줄 요약으로 보여주고, **복구**하면 보류 칸으로 돌아온다.
- 보류·아카이브·컨펌한 세션에 다시 지시를 보내면 자동으로 원래 상태로 돌아온다.

## 롤백

```bash
node install.mjs --uninstall
```

그리고 `~/.claude/CLAUDE.md`의 결재 보고 블록 삭제, `rm -rf ~/.claude/office`. 앱 데이터와 세션은 읽기만 하므로 영향 없음.

## 검증

```bash
npm test
node scripts/metrics.mjs
```

## 알려진 한계

- 세션 제목·딥링크는 앱 내부 파일(`~/Library/Application Support/Claude/claude-code-sessions`)에서 읽는다. 공개 API가 아니라 앱 업데이트로 바뀌면 제목이 폴더명으로, 딥링크가 사라진다(상태 추적은 hooks라 유지).
- hooks 경로는 이 폴더의 절대경로로 등록된다. 폴더를 옮기거나 워크트리를 지우면 `node install.mjs`를 다시 실행해야 한다(파일이 없으면 hook이 exit 1로 끝나 세션은 계속 동작하지만 hook 오류 표시가 뜰 수 있다).
- 앱은 기존 채팅 링크의 `q` 값을 비운다(새 세션 링크 `claude://code/new?q=…`만 입력창을 채움). 그래서 바로 전송은 앱 모드에서 키 입력(⌘V, Enter)으로 하고, 웹 모드는 클립보드 + 채팅방 열기로 전달한다.
- 바로 전송의 화면 확인은 앱 내부 세션 파일의 `lastFocusedAt`에 의존한다. 앱 업데이트로 이 필드가 바뀌면 확인이 실패해 자동 전송이 멈춘다(엉뚱한 곳에 보내지는 않음).
- 화면과 보고 규칙은 한국어다. 대시보드는 `## 결재 보고` 제목과 소제목을 그대로 파싱한다.
