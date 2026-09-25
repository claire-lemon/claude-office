#!/usr/bin/env node
// Demo with fake sessions: node scripts/demo.mjs [publicDir] [port]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [pub = 'public', port = '7770'] = process.argv.slice(2);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-demo-'));
const env = { ...process.env, OFFICE_HOME: home, OFFICE_PUBLIC: pub, OFFICE_PORT: port };
const children = [['scripts/simulate.mjs'], ['server.mjs']].map(args =>
    spawn('node', args.map(a => path.join(ROOT, a)), { env, stdio: 'inherit' }),
);
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => (children.forEach(c => c.kill()), process.exit(0))));
