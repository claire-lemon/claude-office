// 오늘 일지 files (DAILY_DIR/YYYY-MM-DD.md). No business decisions.
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_DIR } from '../config.mjs';

export const pathFor = date => path.join(DAILY_DIR, `${date}.md`);

export const read = date => {
    try {
        return fs.readFileSync(pathFor(date), 'utf8');
    } catch {
        return null;
    }
};

// Atomic (tmp + rename): the facilitator session may be reading the note while the server rewrites it.
export const write = (date, text) => {
    const file = pathFor(date);
    fs.mkdirSync(DAILY_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return file;
};
