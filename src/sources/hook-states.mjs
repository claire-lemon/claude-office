// Hook state files under STATE_DIR. No business decisions.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.mjs';
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

export const loadStates = () =>
    listFiles(STATE_DIR, 0)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ id: path.basename(f, '.json'), ...readJson(f, {}) }))
        .filter(s => s.event && s.at);
