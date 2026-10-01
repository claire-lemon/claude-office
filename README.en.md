# Claude Office

[한국어](README.md) | **English**

A local dashboard for running several Claude Code sessions (Claude desktop app, Code tab) in parallel. Each session is a pixel-art animal "employee" at a desk. When one finishes, its report lands in an approval board (kanban), where you read the report and the git diff, then confirm.
Design notes (Korean): [`docs/specs/2026-09-25-claude-office-design.md`](docs/specs/2026-09-25-claude-office-design.md)

![Claude Office — pixel office and approval board (demo data)](docs/images/office-light.png)

| Detail panel · report | Detail panel · changes |
|---|---|
| ![Report tab: approval report and next tasks](docs/images/panel-report.png) | ![Changes tab: worktree diff](docs/images/panel-diff.png) |

- Zero dependencies (Node 22 standard library + `git`)
- Binds to `127.0.0.1:7777` only
- macOS only (uses the Claude desktop app's local files, `open`, and `pbcopy`). Compatibility and verification status (Korean): [`docs/research/2026-09-28-compat-and-verification.md`](docs/research/2026-09-28-compat-and-verification.md)
- The UI and the report format are in Korean

## Architecture

```mermaid
flowchart TB
    subgraph APP["Claude desktop app"]
        S["Work sessions<br/>one per worktree"]
        NEW["New session input box"]
    end

    HOOK["hooks/report.mjs<br/>UserPromptSubmit · Notification · Stop"]

    subgraph READ["Data the server reads"]
        ST["~/.claude/office/state/*.json<br/>last event per session"]
        EV["~/.claude/office/events/*.jsonl<br/>event history (append-only)"]
        META["App session metadata<br/>title · branch · PR · deep link"]
        TR["Transcripts .jsonl<br/>last reply · approval report"]
        GIT["git per worktree<br/>diff · branch · project"]
    end

    SRV["server.mjs → src/<br/>127.0.0.1:7777"]
    DEC[("~/.claude/office/decisions.json<br/>confirm · hold · archive")]
    UI["Browser<br/>pixel office · approval board<br/>detail panel · archive list"]

    S -- "hook events" --> HOOK --> ST
    HOOK --> EV
    ST --> SRV
    EV --> SRV
    META --> SRV
    TR --> SRV
    GIT --> SRV
    SRV <--> DEC
    SRV -- "/api/sessions every 2s" --> UI
    UI -- "confirm · hold · archive · OK" --> SRV
    SRV -. "confirm → copy + open chat<br/>(⌘V, Enter)" .-> S
    SRV -. "OK → new-session deep link<br/>(Enter)" .-> NEW
```

- Session state comes from hook events; titles, branches, and deep links from the app's files; changes from each worktree's git.
- The server writes only to `~/.claude/office/`. It only reads app data and session files.
- Whenever something goes to a session (confirm, OK), you press the final Enter yourself.

### Code layout

```
server.mjs              entry (runs src/http/server.mjs)
install.mjs             install / uninstall hooks
hooks/report.mjs        the hook (standalone, no imports, for startup speed)
bin/office.mjs          work log CLI (`narrate`; no server needed)
src/
  config.mjs            env vars, paths, limits (the only place env vars are read)
  http/                 controller: normalize input → call a use case → respond; Host/Origin checks
  usecases/             flows: session list, changes, confirm/hold/archive, next task, summary, work log (yesterday's sessions, AI narrative)
  domain/               pure functions: status, wait/turn times (timeline), report parsing, prompts, diff parsing, daily note
  sources/              data in/out: app session files, hook state and event history, transcripts, decisions, git
  platform/             OS side effects: open, pbcopy, claude -p
public/
  index.html            markup skeleton
  css/                  base · office · board · panel · changes · markdown
  js/                   main → api · store → views/ · panel/
  js/lib/               import-free modules: math (grid-math, markdown) and small DOM helpers (splitter, inline-edit)
  js/views/             office, board, header (freshness badge in freshness.js), work log (journal.js). columns.js (columns) and filters.js (filters) are rule tables
  js/panel/             detail panel. actions.js (buttons) is a rule table
test/unit/              pure-function tests
test/integration/       server, fixtures, temp git repos
```

- Dependencies point one way: `http → usecases → domain · sources · platform`. `domain/` is pure (no files, no processes). `public/js/lib/`, `panel/actions.js` and `views/columns.js` import nothing.
- Rules live in tables. A new column, drop rule, filter, button, or editable field is one more row (where: [design §4](docs/specs/2026-09-28-board-interactions-design.md#4-확장-지점-나중에-기능을-붙이는-곳), Korean).
- The server (`src/domain/board.mjs`) decides which column a session is in and where it may be dropped, and sends that as `column` and `moves`. The page only displays it.
- File writes and OS commands live only in `sources/` and `platform/`.
- Design (Korean): [layering and detail panel](docs/specs/2026-09-28-layering-and-panel-design.md), [board interactions](docs/specs/2026-09-28-board-interactions-design.md), [AI narrative](docs/specs/2026-09-29-daily-narrative-design.md), [event history](docs/specs/2026-09-29-event-history-design.md), [removing the todo blackboard and meeting room](docs/specs/2026-10-01-remove-todo-blackboard.md); product review: [`docs/product-review-20260929.md`](docs/product-review-20260929.md)

## Try the demo first (touches no real settings)

```bash
node scripts/demo.mjs public 7770
```

Ten fake sessions change state every 8 seconds. Open `http://127.0.0.1:7770`.

## Use it for real

1. Install the hooks. This backs up `~/.claude/settings.json`, then adds `UserPromptSubmit` / `Notification` / `Stop` hooks.
   ```bash
   node install.mjs
   ```
2. Add the report rule: append [`CLAUDE-report-rule.md`](CLAUDE-report-rule.md) to `~/.claude/CLAUDE.md`. Sessions then end finished work with a `## 결재 보고` ("approval report") block the dashboard can parse.
3. Start the server and open `http://127.0.0.1:7777`.
   ```bash
   node server.mjs
   ```
4. Give a new session a task in the app. Its employee starts typing. When it finishes, it raises a hand ("보고드려요", "reporting in"). Click the card to read the report and diff, then open the chat or confirm.

To open a session's panel directly: `http://127.0.0.1:7777/?open=<session id>` (add `&tab=diff` for the changes tab).

If you installed a version that had the meeting room, run `node install.mjs` once more from the main checkout. It removes the two facilitator read rules that version added (`~/.claude/office/CLAUDE.md`, `~/.claude/office/daily/**`). Running it from a worktree points the hooks at that worktree.

Hooks only see turns that start **after** installation. Older sessions active in the last 24 hours show up grey (state unknown). If there are app sessions but no hook record at all, a banner under the header says to run `node install.mjs`; with no sessions at all, it shows the three setup steps.

### Keep it running (macOS)

Instead of `node server.mjs`, register a user LaunchAgent: the server starts at login and comes back about 10 seconds after it stops. Run this once from this folder (it is a user item in `~/Library/LaunchAgents`, not a system setting).

```bash
mkdir -p ~/.claude/office && cat > ~/Library/LaunchAgents/local.claude-office.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.claude-office</string>
  <key>ProgramArguments</key>
  <array><string>$(command -v node)</string><string>$PWD/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$(command -v node)"):$(dirname "$(command -v claude)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.claude/office/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.claude/office/server.log</string>
</dict>
</plist>
EOF
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.claude-office.plist
```

1. Restart after changing server code: `launchctl kickstart -k gui/$(id -u)/local.claude-office`
2. Unregister: `launchctl bootout gui/$(id -u)/local.claude-office`, then delete `~/Library/LaunchAgents/local.claude-office.plist`
3. Log: `~/.claude/office/server.log`
4. While it is registered, don't start `node server.mjs` yourself (port 7777 would clash). The demo uses another port (7770), so it is fine.
5. The plist holds the node path, so after a node upgrade or moving this folder, unregister and run the block again.

## Office and board

- **Header**: `출근` (checked in) is the number of seated sessions (active in the last 24 hours, plus held ones, 20 desks max). `결재 대기` (awaiting approval) counts reports, 보고 없음 (no report) and blocked sessions, and is the same number as the tab title `(n) 결재 대기`. A session newly entering it (blocked included) plays the sound and sends a browser notification. `n초 전 갱신` (updated n s ago) is when the last poll succeeded; if the server can't be reached it turns into a red **오프라인** (offline) badge and the screen keeps the last data. The **?** button explains bubbles, colors, tags and numbers.
- **Bubbles**: ⌨️ 타닥타닥 (working) · 🖐️ 보고드려요 (report ready) · 💬 보고 없음 (the turn ended without a report block) · 💦 도와주세요 (blocked, e.g. a permission prompt) · ☕ 완료 (done) · ⏸️ 보류 (hold). A greyscale employee has no hook record. The API status value is unchanged (`question` = 보고 없음).
- **Awaiting-approval order**: the card that has waited longest is on top and shows `n분째 대기` (waiting n min). The wait comes from the hook event history (`~/.claude/office/events/`; repeated events count from the first stop). Sessions without history use their last event time.
- **Seats**: desks open five at a time and there is always an empty one (7 sessions → 10 desks, 10 → 15). A row holds at most 10 desks, then wraps. An employee keeps their desk.
- **Resize**: drag the handle between the office and the board to change their heights, and the handles between board columns to change column widths. Desk size follows the office size and head count. Double-click resets; sizes are saved in the browser. Below 800px wide the page just flows top to bottom, without handles.
- **Drag cards**: while you drag a card, the columns that accept it show a dashed border and a label.

  | Drop on | Effect | Allowed from |
  |---|---|---|
  | 보류 (hold) | Hold, same as the hold button | working, awaiting approval, done |
  | 완료 (done) | Marks it done only. No commit/PR (that's the confirm button) | awaiting approval, hold |
  | Its original column (working or awaiting approval) | Undo the hold / done | hold, done |
  | The header's 🗄️ 보관함 (archive list) button | Archive, same as the archive button | any card |

- **Filter**: click the **결재 대기** (awaiting approval) or **보류** (hold) count in the header to see only those sessions (just their desks, and that one column, wide). Click **출근** (checked in) to see everyone again.

## 📓 Work log

**📓 업무일지** (work log) in the header opens the AI narrative of today's note: yesterday told as a story per project, not as a list of sessions.

1. **지금 쓰기 / 다시 쓰기** (write now / rewrite): a model (`claude -p`, haiku, isolated call) tells yesterday's sessions. It takes 1–2 minutes and runs in the server's background; the dialog shows its progress every 2 seconds. Click the note path below to copy it.
2. **The note file** `~/.claude/office/daily/YYYY-MM-DD.md`
   1. Auto block (`<!-- office:auto:start -->` … `end -->`): every session since yesterday 00:00 with status, diff size, folder, one-line summary and suggested next tasks
   2. `## 어제 이야기` block (`<!-- office:narrative:start -->` … `end -->`): a story per project plus "남은 것" (what's left)
   3. Anything you write outside the markers is kept. Open it in Obsidian or any editor.
3. **Written for you**: while the server runs, once a day after 05:00. It checks at start and every 10 minutes and skips a day that already has one.
4. **CLI**: rewrite it now without the server (for cron/launchd)
   ```bash
   node bin/office.mjs narrate
   ```

The todo blackboard, session assignment and the meeting room were removed on 2026-10-01. They were hardly used, and the 결재 보고's "다음 작업" (next tasks) with the **OK** button already plays the todo role inside the sessions. Why, and how to bring them back: [removal record](docs/specs/2026-10-01-remove-todo-blackboard.md) (Korean).

## Detail panel

- **Report tab**: the approval report rendered as markdown. Each "다음 작업" (next task) item has its own **▶ 진행** (run) button. Without a report it falls back to the 요약 만들기 (summary) result, then the Claude app's own per-turn summary (**앱 요약**, no model call), then the whole last reply.
- **Subtitle**: `animal · branch · PR · n turns · 지난 턴 n분` (last turn took n min, `UserPromptSubmit` → `Stop` from the event history).
- **Changes tab**: first shows what it compared against (base branch) and `+added −deleted · files · new files`. New files show their **full content** whether committed or not, and new `.md` files switch between **미리보기 / 원문** (preview / raw); the preview shows a file's YAML frontmatter as a small table, and `[[path|label]]` links show just their label, with the path on hover (code is left as written). Sessions opened without a worktree are compared in their folder's git repo. When there are no changes, it says why. It reloads when the session moves on.
- **Footer**: row 1 is the primary action and "채팅방 열기" (open chat). The primary action is "컨펌 · 커밋·PR" (confirm) while awaiting approval, or "OK · 1번 진행 ▾" (run next task #1, ▾ for #2/#3) when next tasks exist. Row 2 holds the rest (summary, hold, …), with archive in red at the far right. Hovering a button says what it does (OK = mark this session done and open a new session's input box; confirm = copy the instruction and open the chat, you paste and press Enter).
- **Rename**: click the name at the top of the panel to edit it. Enter or clicking elsewhere saves, Esc cancels, and saving it empty brings back the app's name. The new name is dashboard-only; the Claude app's sidebar keeps its own.
- **Resize**: drag the panel's left edge, or focus the handle and use ←/→; double-click resets the width. The width is saved in the browser.

## Board columns

| Column | Meaning |
|---|---|
| 작업 중 (working) | The session is running |
| 결재 대기 (awaiting approval) | Finished with a report, finished without one ("보고 없음" tag), or blocked on a permission prompt (red "막힘" tag). Longest-waiting first |
| 보류 (on hold) | You parked it |
| 완료 (done) | You confirmed it |

## Confirm and next task

1. **컨펌 · 커밋·PR** (confirm · commit/PR) copies an instruction to the clipboard and opens that chat. Press ⌘V, then Enter. The session commits, pushes, opens a PR, and recommends next tasks.
2. When a report includes a `### 다음 작업` (next tasks) section, press **OK · 1번 진행** (OK · run #1), or pick another number. A new session opens with the prompt filled in. Press Enter.

## Hold, archive, and the archive list

- **보류** (hold) moves the card to the hold column and does nothing else. Held cards stay on the board past 24 hours.
- **아카이브** (archive) removes the card from the office and the board. **모두 아카이브** (archive all) in the done column's header clears that column in one click.
- **🗄️ 보관함** (archive list, in the header) lists archived work as name · date · one-line summary. **복구** (restore) puts it back in the hold column.
- If you send a new prompt to a held, archived, or confirmed session, it returns to its normal state automatically.

## Uninstall

```bash
node install.mjs --uninstall
```

This removes only the office hooks (and the facilitator read rules an older version added). Then delete the `## 결재 보고 (Claude Office)` block from `~/.claude/CLAUDE.md` and run `rm -rf ~/.claude/office` (decisions, renames, daily notes and the event history live there, plus an older version's todos, links and facilitator guide). To drop only the event history, `rm -rf ~/.claude/office/events` (wait times fall back to the last event and the last-turn time goes blank). The dashboard only reads app data and sessions, so nothing else changes.

## Tests

```bash
npm test
node scripts/metrics.mjs
```

## Known limits

- Session titles and chat deep links come from the desktop app's internal files (`~/Library/Application Support/Claude/claude-code-sessions`). They are not a public API. If an app update changes them, titles fall back to folder names and deep links disappear. State tracking keeps working because it uses hooks.
- Hooks are registered with this folder's absolute path. If you move the folder, run `node install.mjs` again. Until you do, the hook exits with an error; sessions keep working but may show a hook error.
- No deep link that fills an existing chat's input box was found in the app, so confirm goes through the clipboard (⌘V, Enter). New sessions use the `claude://code/new?q=…` deep link, which fills the input box without sending it.
- Notes use the server's local date.
- The AI narrative runs on a timer inside the server, so nothing is written while the server is off (it checks as soon as it starts). To run it without the server, put `node bin/office.mjs narrate` in cron/launchd. The narrative is a model summary and can be wrong (for example, blending two sessions into one sentence).
- Dragging cards needs a mouse. From the keyboard, the detail panel's hold / unhold / confirm buttons do the same.
- The event history is never pruned automatically. A line is about 50 bytes, so even a 200-turn session is around 30KB, and the server reads only the last 64KB.
- No token or cost figures yet (it needs an incremental read of the whole transcript; see [event history design §7](docs/specs/2026-09-29-event-history-design.md)).
- The dashboard parses the Korean `## 결재 보고` heading and its sub-headings exactly as written.
