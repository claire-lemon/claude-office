#!/usr/bin/env node
// Claude Code hook: records the latest session event for the office dashboard.
// Must never disturb the working session: no stdout, always exit 0.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

try {
    // Set by the dashboard's own `claude -p` summarizer so it never shows up as a session.
    if (process.env.OFFICE_SKIP_HOOK) process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const id = String(input.session_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const event = input.hook_event_name;
    if (id && ['UserPromptSubmit', 'Notification', 'Stop'].includes(event)) {
        const dir = path.join(process.env.OFFICE_HOME || os.homedir(), '.claude/office/state');
        const file = path.join(dir, `${id}.json`);
        const prev = (() => {
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch {
                return null;
            }
        })();
        // Idle "waiting for input" notifications after a finished turn must not flip review -> blocked.
        if (!(event === 'Notification' && prev?.event === 'Stop')) {
            fs.mkdirSync(dir, { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(
                tmp,
                JSON.stringify({
                    event,
                    at: Date.now(),
                    cwd: input.cwd || null,
                    transcriptPath: input.transcript_path || null,
                    message: event === 'Notification' ? String(input.message || '').slice(0, 200) : null,
                }),
            );
            fs.renameSync(tmp, file);
        }
    }
} catch {
    // swallow: the dashboard is optional, the session is not
}
process.exit(0);
