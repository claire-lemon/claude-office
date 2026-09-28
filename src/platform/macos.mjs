// macOS side effects: open a URL, copy to the clipboard. DRY handling lives here (config.DRY).
import { execFile } from 'node:child_process';
import { DRY } from '../config.mjs';

export const openUrl = link => (DRY ? null : execFile('open', [link], () => {}));

export const copyToClipboard = text =>
    new Promise(resolve => {
        if (DRY) return resolve();
        // pbcopy drops non-ASCII text entirely when the locale is unset (e.g. launched from an app).
        const child = execFile('pbcopy', [], { env: { ...process.env, LANG: 'en_US.UTF-8' } }, () => resolve());
        child.stdin.end(text);
    });
