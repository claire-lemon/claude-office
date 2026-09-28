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
        META["App session metadata<br/>title · branch · PR · deep link"]
        TR["Transcripts .jsonl<br/>last reply · approval report"]
        GIT["git per worktree<br/>diff · branch · project"]
    end

    SRV["server.mjs → src/<br/>127.0.0.1:7777"]
    DEC[("~/.claude/office/decisions.json<br/>confirm · hold · archive")]
    UI["Browser<br/>pixel office · approval board<br/>detail panel · archive list"]

    S -- "hook events" --> HOOK --> ST
    ST --> SRV
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
src/
  config.mjs            env vars, paths, limits (the only place env vars are read)
  http/                 controller: normalize input → call a use case → respond; Host/Origin checks
  usecases/             flows: session list, changes, confirm/hold/archive, next task, summary
  domain/               pure functions: status, report parsing, prompts, diff parsing
  sources/              data in/out: app session files, hook state, transcripts, decisions, git
  platform/             OS side effects: open, pbcopy, claude -p
public/
  index.html            markup skeleton
  css/                  base · office · board · panel · changes · markdown
  js/                   main → api · store → views/ · panel/
  js/lib/               import-free modules: math (grid-math, markdown) and small DOM helpers (splitter, inline-edit)
  js/views/             office, board, header. columns.js (columns) and filters.js (filters) are rule tables
  js/panel/             detail panel. actions.js (buttons) is a rule table
test/unit/              pure-function tests
test/integration/       server, fixtures, temp git repos
```

- Dependencies point one way: `http → usecases → domain · sources · platform`. `domain/` is pure (no files, no processes). `public/js/lib/`, `panel/actions.js` and `views/columns.js` import nothing.
- Rules live in tables. A new column, drop rule, filter, button, or editable field is one more row (where: [design §4](docs/specs/2026-09-28-board-interactions-design.md#4-확장-지점-나중에-기능을-붙이는-곳), Korean).
- The server (`src/domain/board.mjs`) decides which column a session is in and where it may be dropped, and sends that as `column` and `moves`. The page only displays it.
- File writes and OS commands live only in `sources/` and `platform/`.
- Design (Korean): [layering and detail panel](docs/specs/2026-09-28-layering-and-panel-design.md), [board interactions](docs/specs/2026-09-28-board-interactions-design.md)

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

Hooks only see turns that start **after** installation. Older sessions active in the last 24 hours show up grey (state unknown).

## Office and board

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

## Detail panel

- **Report tab**: the approval report rendered as markdown. Each "다음 작업" (next task) item has its own **▶ 진행** (run) button.
- **Changes tab**: first shows what it compared against (base branch) and `+added −deleted · files · new files`. New files show their **full content** whether committed or not, and new `.md` files switch between **미리보기 / 원문** (preview / raw); the preview shows a file's YAML frontmatter as a small table (`[[path|label]]` links show their label). Sessions opened without a worktree are compared in their folder's git repo. When there are no changes, it says why. It reloads when the session moves on.
- **Footer**: row 1 is the primary action and "채팅방 열기" (open chat). The primary action is "컨펌 · 커밋·PR" (confirm) while awaiting approval, or "OK · 1번 진행 ▾" (run next task #1, ▾ for #2/#3) when next tasks exist. Row 2 holds the rest (summary, hold, …), with archive in red at the far right.
- **Rename**: click the name at the top of the panel to edit it. Enter or clicking elsewhere saves, Esc cancels, and saving it empty brings back the app's name. The new name is dashboard-only; the Claude app's sidebar keeps its own.
- **Resize**: drag the panel's left edge, or focus the handle and use ←/→; double-click resets the width. The width is saved in the browser.

## Board columns

| Column | Meaning |
|---|---|
| 작업 중 (working) | The session is running |
| 결재 대기 (awaiting approval) | Finished with a report, asked a question, or blocked on a permission prompt (red "막힘" tag) |
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

Then delete the `## 결재 보고 (Claude Office)` block from `~/.claude/CLAUDE.md` and run `rm -rf ~/.claude/office`. The dashboard only reads app data and sessions, so nothing else changes.

## Tests

```bash
npm test
node scripts/metrics.mjs
```

## Known limits

- Session titles and chat deep links come from the desktop app's internal files (`~/Library/Application Support/Claude/claude-code-sessions`). They are not a public API. If an app update changes them, titles fall back to folder names and deep links disappear. State tracking keeps working because it uses hooks.
- Hooks are registered with this folder's absolute path. If you move the folder, run `node install.mjs` again. Until you do, the hook exits with an error; sessions keep working but may show a hook error.
- No deep link that fills an existing chat's input box was found in the app, so confirm goes through the clipboard (⌘V, Enter). New sessions use the `claude://code/new?q=…` deep link, which fills the input box without sending it.
- Dragging cards needs a mouse. From the keyboard, the detail panel's hold / unhold / confirm buttons do the same.
- The dashboard parses the Korean `## 결재 보고` heading and its sub-headings exactly as written.
