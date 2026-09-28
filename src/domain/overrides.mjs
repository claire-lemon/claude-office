// Pure per-session override rules (dashboard-only edits such as the title). A new editable field is one row.
export const EDITABLE_FIELDS = { title: { maxLength: 80 } };

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Control chars (newlines included) become spaces; the cut counts code points so Korean/emoji aren't split.
const clean = (value, maxLength) =>
    [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, maxLength).join('').trim() || null;

// -> { ok: true, patch } | { ok: false, error }. A null value (or one that cleans to '') resets the field.
export const normalizePatch = raw => {
    if (!isPlainObject(raw)) return { ok: false, error: 'body must be an object' };
    const keys = Object.keys(raw);
    if (!keys.length) return { ok: false, error: 'empty patch' };
    const unknown = keys.find(k => !Object.hasOwn(EDITABLE_FIELDS, k));
    if (unknown) return { ok: false, error: `unknown field: ${unknown}` };
    const bad = keys.find(k => raw[k] !== null && typeof raw[k] !== 'string');
    if (bad) return { ok: false, error: `${bad} must be a string` };
    return { ok: true, patch: Object.fromEntries(keys.map(k => [k, raw[k] === null ? null : clean(raw[k], EDITABLE_FIELDS[k].maxLength)])) };
};

// null = nothing left to override (the caller deletes the entry).
export const mergeOverride = (current, patch, at) => {
    const fields = Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([k, v]) => k !== 'at' && v !== null));
    return Object.keys(fields).length ? { ...fields, at } : null;
};
