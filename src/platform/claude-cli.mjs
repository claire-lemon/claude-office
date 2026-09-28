// The isolated `claude -p` summarizer call: no tools, no saved session, no hooks, temp cwd.
import { execFile } from 'node:child_process';
import os from 'node:os';

const summaryArgs = systemPrompt => ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--system-prompt', systemPrompt];

export const runSummarizer = (input, systemPrompt, timeout = 60000) =>
    new Promise((resolve, reject) => {
        const opts = { timeout, maxBuffer: 4 * 1024 * 1024, cwd: os.tmpdir(), env: { ...process.env, OFFICE_SKIP_HOOK: '1' } };
        const child = execFile('claude', summaryArgs(systemPrompt), opts, (err, out) => (err ? reject(err) : resolve(out)));
        child.stdin.end(input);
    });
