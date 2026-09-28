// All env var reading lives here. Every other module gets paths/limits/flags via import, never process.env.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

export const PORT = Number(process.env.OFFICE_PORT || 7777);
export const PUBLIC_DIR = path.join(ROOT, process.env.OFFICE_PUBLIC || 'public');
export const DRY = !!process.env.OFFICE_DRY;

export const DAY = 24 * 60 * 60 * 1000;
export const MAX_DESKS = 20;
export const TAIL_BYTES = 256 * 1024;
export const HEAD_BYTES = 16 * 1024; // transcript head scanned for a #todo- marker
export const TODO_FOLDERS_LIMIT = 20; // recent project folders offered by the todo form
export const DIFF_FILE_LIMIT = 200 * 1024; // per-file patch bytes before tooLarge
export const DIFF_TOTAL_LIMIT = 1024 * 1024; // total patch bytes before truncated
export const DIFF_MAX_UNTRACKED = 30; // max untracked files rendered as added patches
