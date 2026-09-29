// Hook event history under EVENTS_DIR (docs/specs/2026-09-29-event-history-design.md §3). Reads the tail
// only, cached by size+mtime. No business decisions.
import fs from 'node:fs';
import path from 'node:path';
import { EVENTS_DIR, EVENTS_TAIL_BYTES } from '../config.mjs';

const parseLine = line => {
    try {
        const o = JSON.parse(line);
        return o && typeof o.event === 'string' && Number.isFinite(o.at) ? { event: o.event, at: o.at } : null;
    } catch {
        return null; // includes the cut-off first line of the tail window
    }
};

// [{ event, at }] oldest first; missing file -> [].
const cache = new Map();
export const loadEvents = cli => {
    const file = path.join(EVENTS_DIR, `${String(cli).replace(/[^a-zA-Z0-9_-]/g, '')}.jsonl`);
    try {
        const st = fs.statSync(file);
        const key = `${st.size}:${st.mtimeMs}`;
        const hit = cache.get(file);
        if (hit && hit.key === key) return hit.events;
        const start = Math.max(0, st.size - EVENTS_TAIL_BYTES);
        const buf = Buffer.alloc(st.size - start);
        const fd = fs.openSync(file, 'r');
        try {
            fs.readSync(fd, buf, 0, buf.length, start);
        } finally {
            fs.closeSync(fd);
        }
        const events = buf.toString('utf8').split('\n').map(parseLine).filter(Boolean);
        cache.set(file, { key, events });
        return events;
    } catch {
        return [];
    }
};
