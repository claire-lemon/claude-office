#!/usr/bin/env node
// 업무일지 CLI: `narrate` writes today's AI 서술 without the server (cron/launchd). Same usecase and files as the
// server (OFFICE_HOME via config). Always prints one JSON value; any failure exits 1 with { "error": "…" }.
import { narrateNote } from '../src/usecases/narrate.mjs';

const USAGE = 'usage: node bin/office.mjs narrate';

const result = await (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0] !== 'narrate') return { error: `unknown command: ${args.join(' ') || '(none)'}\n${USAGE}` };
    try {
        return await narrateNote();
    } catch (e) {
        return { error: String(e.message || e) };
    }
})();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.error) process.exitCode = 1;
