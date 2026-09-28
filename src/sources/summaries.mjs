// Per-session summary files under SUMMARY_DIR. No business decisions (staleness is the caller's call).
import fs from 'node:fs';
import path from 'node:path';
import { SUMMARY_DIR } from '../config.mjs';

export const read = id => {
    const file = path.join(SUMMARY_DIR, `${id}.md`);
    if (!fs.existsSync(file)) return null;
    return { text: fs.readFileSync(file, 'utf8'), at: fs.statSync(file).mtimeMs };
};

export const write = (id, text) => {
    fs.mkdirSync(SUMMARY_DIR, { recursive: true });
    fs.writeFileSync(path.join(SUMMARY_DIR, `${id}.md`), text);
};
