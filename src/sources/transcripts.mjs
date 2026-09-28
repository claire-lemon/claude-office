// Transcript head/tail reading. No business decisions.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, TAIL_BYTES, HEAD_BYTES } from '../config.mjs';

export const transcriptPathFor = (cwd, cliSessionId) =>
    path.join(HOME, '.claude/projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), `${cliSessionId}.jsonl`);

const parseTail = (fd, size, bytes) => {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf
        .toString('utf8')
        .split('\n')
        .reverse()
        .map(l => {
            try {
                return JSON.parse(l);
            } catch {
                return null; // includes the cut-off first line of the window
            }
        })
        .filter(d => d && d.type === 'assistant' && !d.isSidechain && Array.isArray(d.message?.content))
        .map(d => d.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n'))
        .find(t => t.trim());
};

// Last assistant text of a transcript. Reads only the tail; if the last reply is one line bigger than the
// window (it is then cut mid-line and unparseable), widen 256KB -> 4MB -> whole file. Cached by size+mtime
// so a 2s poll doesn't re-read big transcripts.
const TAIL_STEPS = [TAIL_BYTES, 4 * 1024 * 1024, Infinity];
const tailCache = new Map();
export const lastAssistantText = file => {
    try {
        const st = fs.statSync(file);
        const key = `${st.size}:${st.mtimeMs}`;
        const hit = tailCache.get(file);
        if (hit && hit.key === key) return hit.text;
        const fd = fs.openSync(file, 'r');
        try {
            const text = TAIL_STEPS.reduce((found, bytes, i) => {
                if (found !== undefined) return found;
                const t = parseTail(fd, st.size, bytes);
                const coveredAll = bytes >= st.size || i === TAIL_STEPS.length - 1;
                return t !== undefined ? t : coveredAll ? '' : undefined;
            }, undefined) || '';
            tailCache.set(file, { key, text });
            return text;
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return '';
    }
};

// First HEAD_BYTES of a transcript (the first prompt sits there). Once the file has a full head it never
// changes, so it is cached by path; a shorter file is re-read only when its size moves (the first prompt
// line may not be written yet). Missing file -> ''.
const headCache = new Map();
export const firstPromptHead = file => {
    const hit = headCache.get(file);
    if (hit?.full) return hit.text;
    try {
        const { size } = fs.statSync(file);
        if (hit && hit.size === size) return hit.text;
        const fd = fs.openSync(file, 'r');
        try {
            const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
            fs.readSync(fd, buf, 0, buf.length, 0);
            const text = buf.toString('utf8');
            headCache.set(file, { size, full: buf.length === HEAD_BYTES, text });
            return text;
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return '';
    }
};

// The first real user prompt in the head: string content or text blocks, the app's <system-reminder> blocks
// cut. Preamble lines (queue entries, attachments), tool results and a line cut at HEAD_BYTES yield ''.
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const promptOf = line => {
    try {
        const o = JSON.parse(line);
        const c = o.type === 'user' && !o.isMeta ? o.message?.content : null;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
        return text.replace(REMINDER, '').trim();
    } catch {
        return '';
    }
};
export const firstPromptText = file => {
    const line = firstPromptHead(file).split('\n').find(promptOf);
    return line ? promptOf(line) : '';
};
