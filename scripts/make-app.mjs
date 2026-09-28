#!/usr/bin/env node
// Builds "~/Applications/Claude Office.app": double-click starts the server in the background (if it isn't
// running) and opens the dashboard. macOS Accessibility permission for direct send is granted to this app once,
// and its path doesn't change when Node or Claude Code update.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(os.homedir(), 'Applications', 'Claude Office.app');
const LOG = path.join(os.homedir(), '.claude', 'office', 'server.log');
const PORT = 7777;
const BUNDLE_ID = 'io.github.claire-lemon.claude-office';
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`; // shell single-quote

// Apps launched from Finder get a bare PATH; keep this shell's so `node`, `git` and `claude` resolve.
const shell = [
    `export PATH=${q(process.env.PATH)}`,
    `mkdir -p ${q(path.dirname(LOG))}`,
    `if ! lsof -ti tcp:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then cd ${q(ROOT)} && nohup node server.mjs >> ${q(LOG)} 2>&1 & fi`,
].join('; ');
const asString = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const script = `on run
    do shell script ${asString(shell)}
    delay 1
    open location "http://127.0.0.1:${PORT}"
end run`;

fs.mkdirSync(path.dirname(APP), { recursive: true });
fs.rmSync(APP, { recursive: true, force: true });
execFileSync('osacompile', ['-o', APP, '-e', script]);
// osacompile leaves out CFBundleIdentifier; without it macOS matches the Accessibility grant by the inner
// binary path instead of the app, so a grant made in System Settings never applies. Add one and re-sign.
execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :CFBundleIdentifier string ${BUNDLE_ID}`, path.join(APP, 'Contents', 'Info.plist')]);
execFileSync('codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, APP]);
console.log(`built ${APP} (${BUNDLE_ID})`);
console.log('Rebuilding makes macOS treat it as a new app: re-add it under Privacy & Security > Accessibility.');
