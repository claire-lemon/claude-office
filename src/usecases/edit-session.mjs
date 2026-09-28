// editSession(session, raw): dashboard-only edits (title). The Claude app's own name is never touched.
import * as overridesStore from '../sources/overrides.mjs';
import { normalizePatch, mergeOverride } from '../domain/overrides.mjs';

export const editSession = (session, raw) => {
    const result = normalizePatch(raw);
    if (!result.ok) return { error: result.error };
    const next = mergeOverride(overridesStore.load()[session.id], result.patch, Date.now());
    overridesStore.save(session.id, next);
    return { ok: true, title: next?.title || session.appTitle, appTitle: session.appTitle };
};
