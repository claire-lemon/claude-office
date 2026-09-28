// The facilitator folder's CLAUDE.md (GUIDE_FILE). No business decisions: the caller supplies text + header.
import fs from 'node:fs';
import path from 'node:path';
import { GUIDE_FILE } from '../config.mjs';

// Writes the guide when it is missing or its first line isn't `header`; a same-version file is left alone
// so hand edits survive. -> 'created' | 'updated' | 'kept'
export const ensureGuide = (text, header) => {
    const current = (() => {
        try {
            return fs.readFileSync(GUIDE_FILE, 'utf8');
        } catch {
            return null;
        }
    })();
    if (current !== null && current.split('\n', 1)[0].trim() === header) return 'kept';
    fs.mkdirSync(path.dirname(GUIDE_FILE), { recursive: true });
    const tmp = `${GUIDE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, GUIDE_FILE);
    return current === null ? 'created' : 'updated';
};
