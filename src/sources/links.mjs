// 할 일 ↔ 세션 연결 스냅샷 ({ [sessionId]: LinkRecord }, todo-history design §3.1). No business decisions.
import { LINKS_FILE } from '../config.mjs';
import { readJson, writeJsonAtomic } from './json-store.mjs';

export const load = () => readJson(LINKS_FILE, {});
export const saveMany = records => writeJsonAtomic(LINKS_FILE, { ...load(), ...records });
export const remove = ids => writeJsonAtomic(LINKS_FILE, Object.fromEntries(Object.entries(load()).filter(([id]) => !ids.includes(id))));
