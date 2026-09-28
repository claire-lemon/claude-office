// Generic JSON file IO. No business decisions.
import fs from 'node:fs';
import path from 'node:path';

export const readJson = (file, fallback = null) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
};

export const writeJsonAtomic = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
};
