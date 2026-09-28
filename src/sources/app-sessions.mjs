// App session metadata under APP_DIR (mtime-cached). No business decisions.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../config.mjs';
import { readJson } from './json-store.mjs';

const listFiles = (dir, depth) => {
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return depth > 0 ? listFiles(p, depth - 1) : [];
            return [p];
        });
    } catch {
        return [];
    }
};

// ponytail: app layout is <uuid>/<uuid>/local_*.json; internal format, fail-soft if it moves.
const appCache = new Map();
export const loadAppSessions = () =>
    listFiles(APP_DIR, 2)
        .filter(f => path.basename(f).startsWith('local_') && f.endsWith('.json'))
        .map(f => {
            const mtime = fs.statSync(f).mtimeMs;
            const hit = appCache.get(f);
            if (hit && hit.mtime === mtime) return hit.data;
            const data = readJson(f);
            appCache.set(f, { mtime, data });
            return data;
        })
        .filter(s => s && s.cliSessionId);
