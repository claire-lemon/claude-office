// All env var reading lives here. Every other module gets paths/limits/flags via import, never process.env.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HOME = process.env.OFFICE_HOME || os.homedir();
export const APP_DIR =
    process.env.OFFICE_APP_DIR || path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions');
export const OFFICE_DIR = path.join(HOME, '.claude/office');
export const STATE_DIR = path.join(OFFICE_DIR, 'state');
export const CONFIRMED_FILE = path.join(OFFICE_DIR, 'confirmed.json');
export const SUMMARY_DIR = path.join(OFFICE_DIR, 'summaries');
export const DECISIONS_FILE = path.join(OFFICE_DIR, 'decisions.json');
export const OVERRIDES_FILE = path.join(OFFICE_DIR, 'overrides.json');
export const TODOS_FILE = path.join(OFFICE_DIR, 'todos.json');
export const LINKS_FILE = path.join(OFFICE_DIR, 'links.json'); // 할 일 ↔ 세션 연결 스냅샷 (todo-history design §3.1)
export const DAILY_DIR = path.join(OFFICE_DIR, 'daily'); // 오늘 일지 YYYY-MM-DD.md
export const GUIDE_FILE = path.join(OFFICE_DIR, 'CLAUDE.md'); // the facilitator session's instructions

export const PORT = Number(process.env.OFFICE_PORT || 7777);
export const PUBLIC_DIR = path.join(ROOT, process.env.OFFICE_PUBLIC || 'public');
export const DRY = !!process.env.OFFICE_DRY;

export const DAY = 24 * 60 * 60 * 1000;
export const MAX_DESKS = 20;
export const TAIL_BYTES = 256 * 1024;
// Transcript head scanned for #todo- / #meeting- markers. A real transcript opens with ~30KB of app
// preamble (queue entries, hook attachments) before the first prompt, so 16KB missed it.
export const HEAD_BYTES = 256 * 1024;
export const TODO_FOLDERS_LIMIT = 20; // recent project folders offered by the todo form
export const DIFF_FILE_LIMIT = 200 * 1024; // per-file patch bytes before tooLarge
export const DIFF_TOTAL_LIMIT = 1024 * 1024; // total patch bytes before truncated
export const DIFF_MAX_UNTRACKED = 30; // max untracked files rendered as added patches
// 오늘 일지 AI 서술: written once a day after this local hour, so late-night work still counts as 어제.
export const NARRATE_HOUR = 5;
export const NARRATE_EVERY = 10 * 60 * 1000; // server check interval (a failed run retries on the next check)
// The server timer runs for the real office only: fixture homes (tests, demo, metrics) never call the model.
export const NARRATE_AUTO = !DRY && HOME === os.homedir();
// 회의실 → 칠판 (meeting-board-sync design §2.3): how often the server copies the facilitator's `### 칠판` list.
export const MEETING_SYNC_EVERY = 3000;
