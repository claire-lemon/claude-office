#!/usr/bin/env node
// node install.mjs            -> add office hooks + facilitator read rules to ~/.claude/settings.json (backup first)
// node install.mjs --uninstall -> remove only those
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, GUIDE_FILE, DAILY_DIR } from './src/config.mjs';

const SETTINGS = path.join(HOME, '.claude/settings.json');
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks/report.mjs');
const MARK = 'claude-office/hooks/report.mjs';
const EVENTS = ['UserPromptSubmit', 'Notification', 'Stop'];
// The 회의실 facilitator reads only its guide and today's note, both outside its cwd (the app opens it in a
// worktree or a scratch folder), so each Read asked for a click. `//` = absolute path in a permission rule.
const READS = [`Read(/${GUIDE_FILE})`, `Read(/${DAILY_DIR}/**)`];
const uninstall = process.argv.includes('--uninstall');

const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-office-${Date.now()}`);

// MARK for installs from the usual checkout; HOOK for one from any other folder (a worktree, a renamed clone).
const isOurs = group => (group.hooks || []).some(h => [MARK, HOOK].some(m => String(h.command || '').includes(m)));
const stripped = Object.fromEntries(
    Object.entries(settings.hooks || {})
        .map(([event, groups]) => [event, groups.filter(g => !isOurs(g))])
        .filter(([, groups]) => groups.length),
);
const ours = { hooks: [{ type: 'command', command: `node "${HOOK}"`, timeout: 5 }] };
const hooks = uninstall
    ? stripped
    : EVENTS.reduce((acc, e) => ({ ...acc, [e]: [...(acc[e] || []), ours] }), stripped);

const allow = [...(settings.permissions?.allow || []).filter(r => !READS.includes(r)), ...(uninstall ? [] : READS)];
const { allow: _oldAllow, ...perms } = settings.permissions || {};
const permissions = allow.length ? { ...perms, allow } : perms;
// Spread keeps each key where it was; an emptied permissions/hooks is dropped (uninstall restores the file).
const next = Object.fromEntries(
    Object.entries({ ...settings, permissions, hooks }).filter(([k, v]) => !['permissions', 'hooks'].includes(k) || Object.keys(v).length),
);
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
fs.writeFileSync(SETTINGS, `${JSON.stringify(next, null, 2)}\n`);
console.log(uninstall ? 'office hooks and read rules removed' : `office hooks installed -> ${HOOK}\nfacilitator read rules: ${READS.join(', ')}`);
