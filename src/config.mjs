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
export const EVENTS_DIR = path.join(OFFICE_DIR, 'events'); // hook history <cli id>.jsonl (event-history design §3)
export const CONFIRMED_FILE = path.join(OFFICE_DIR, 'confirmed.json');
export const SUMMARY_DIR = path.join(OFFICE_DIR, 'summaries');
export const DECISIONS_FILE = path.join(OFFICE_DIR, 'decisions.json');
export const OVERRIDES_FILE = path.join(OFFICE_DIR, 'overrides.json');
export const DAILY_DIR = path.join(OFFICE_DIR, 'daily'); // 오늘 일지 YYYY-MM-DD.md

export const PORT = Number(process.env.OFFICE_PORT || 7777);
export const PUBLIC_DIR = path.join(ROOT, process.env.OFFICE_PUBLIC || 'public');
export const DRY = !!process.env.OFFICE_DRY;

export const DAY = 24 * 60 * 60 * 1000;
export const MAX_DESKS = 20;
export const TAIL_BYTES = 256 * 1024;
export const EVENTS_TAIL_BYTES = 64 * 1024; // event history read per session (event-history design §5)
// Transcript head scanned for the first prompt (the 업무일지 narrator's 요청). A real transcript opens with
// ~30KB of app preamble (queue entries, hook attachments) before it, so 16KB missed it.
export const HEAD_BYTES = 256 * 1024;
export const DIFF_FILE_LIMIT = 200 * 1024; // per-file patch bytes before tooLarge
export const DIFF_TOTAL_LIMIT = 1024 * 1024; // total patch bytes before truncated
export const DIFF_MAX_UNTRACKED = 30; // max untracked files rendered as added patches
// 오늘 일지 AI 서술: written once a day after this local hour, so late-night work still counts as 어제.
export const NARRATE_HOUR = 5;
export const NARRATE_EVERY = 10 * 60 * 1000; // server check interval (a failed run retries on the next check)
// The server timer runs for the real office only: fixture homes (tests, demo, metrics) never call the model.
export const NARRATE_AUTO = !DRY && HOME === os.homedir();
