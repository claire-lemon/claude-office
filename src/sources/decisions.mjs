// Decision storage (confirm | hold | archive). No business decisions beyond legacy-format merging.
import { CONFIRMED_FILE, DECISIONS_FILE } from '../config.mjs';
import { readJson, writeJsonAtomic } from './json-store.mjs';

// A session carries at most one lead decision: confirm | hold | archive. It applies until a newer hook event
// (e.g. the user sends another prompt), so resumed work always comes back on its own.
// confirmed.json is the pre-decisions format; still read so old confirms keep working.
export const load = () => ({
    ...Object.fromEntries(Object.entries(readJson(CONFIRMED_FILE, {})).map(([id, at]) => [id, { kind: 'confirm', at }])),
    ...readJson(DECISIONS_FILE, {}),
});
export const save = (id, decision) => writeJsonAtomic(DECISIONS_FILE, { ...readJson(DECISIONS_FILE, {}), [id]: decision });
export const clear = id => {
    const { [id]: _d, ...decisions } = readJson(DECISIONS_FILE, {});
    const { [id]: _c, ...confirmed } = readJson(CONFIRMED_FILE, {});
    writeJsonAtomic(DECISIONS_FILE, decisions);
    writeJsonAtomic(CONFIRMED_FILE, confirmed);
};
