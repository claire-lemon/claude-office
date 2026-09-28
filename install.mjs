#!/usr/bin/env node
// node install.mjs            -> add office hooks to ~/.claude/settings.json (backup first)
// node install.mjs --uninstall -> remove only the office hooks
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from './src/config.mjs';

const SETTINGS = path.join(HOME, '.claude/settings.json');
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks/report.mjs');
const MARK = 'claude-office/hooks/report.mjs';
const EVENTS = ['UserPromptSubmit', 'Notification', 'Stop'];
const uninstall = process.argv.includes('--uninstall');

const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-office-${Date.now()}`);

const isOurs = group => (group.hooks || []).some(h => String(h.command || '').includes(MARK));
const stripped = Object.fromEntries(
    Object.entries(settings.hooks || {})
        .map(([event, groups]) => [event, groups.filter(g => !isOurs(g))])
        .filter(([, groups]) => groups.length),
);
const ours = { hooks: [{ type: 'command', command: `node "${HOOK}"`, timeout: 5 }] };
const hooks = uninstall
    ? stripped
    : EVENTS.reduce((acc, e) => ({ ...acc, [e]: [...(acc[e] || []), ours] }), stripped);

const { hooks: _old, ...rest } = settings;
const next = Object.keys(hooks).length ? { ...rest, hooks } : rest;
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
fs.writeFileSync(SETTINGS, `${JSON.stringify(next, null, 2)}\n`);
console.log(uninstall ? 'office hooks removed' : `office hooks installed -> ${HOOK}`);
