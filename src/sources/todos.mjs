// Todo storage ({ [id]: TodoRecord }, only what the user wrote). No business decisions.
import { TODOS_FILE } from '../config.mjs';
import { readJson, writeJsonAtomic } from './json-store.mjs';

export const load = () => readJson(TODOS_FILE, {});
export const save = (id, record) => writeJsonAtomic(TODOS_FILE, { ...load(), [id]: record });
