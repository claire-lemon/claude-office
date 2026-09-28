// Override storage ({ [id]: { title, at } }). No business decisions.
import { OVERRIDES_FILE } from '../config.mjs';
import { readJson, writeJsonAtomic } from './json-store.mjs';

export const load = () => readJson(OVERRIDES_FILE, {});
// null deletes the entry, so a reset leaves no trace in the file.
export const save = (id, override) => {
    const { [id]: _old, ...rest } = load();
    writeJsonAtomic(OVERRIDES_FILE, override === null ? rest : { ...rest, [id]: override });
};
