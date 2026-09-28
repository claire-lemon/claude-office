// confirm / hold / archive / restore / undo / listArchived / openChat: same semantics as before.
import * as decisionsStore from '../sources/decisions.mjs';
import { loadAppSessions } from '../sources/app-sessions.mjs';
import { loadStates } from '../sources/hook-states.mjs';
import { activeDecision } from '../domain/status.mjs';
import { oneLineSummary } from '../domain/report.mjs';
import { CONFIRM_INSTRUCTION } from '../domain/prompts.mjs';
import { openUrl, copyToClipboard } from '../platform/macos.mjs';

export const markConfirmed = id => decisionsStore.save(id, { kind: 'confirm', at: Date.now() });

// Confirm = hand the session its "commit -> PR -> recommend next" instruction.
// Existing chats can't be prefilled by deep link, so it goes to the clipboard and the chat opens.
export const confirm = session => {
    markConfirmed(session.id);
    copyToClipboard(CONFIRM_INSTRUCTION);
    if (session.link?.startsWith('claude://')) openUrl(session.link);
    return { copied: CONFIRM_INSTRUCTION, opened: session.link || null };
};

// Hold = park it in the 보류 column. No message, no side effects.
export const hold = id => decisionsStore.save(id, { kind: 'hold', at: Date.now() });

// Archive = drop it from the office and board; a snapshot keeps the 보관함 row readable later.
export const archive = session =>
    decisionsStore.save(session.id, { kind: 'archive', at: Date.now(), title: session.title, summary: oneLineSummary(session), lastAt: session.lastAt });

// Restore from 보관함 lands in 보류. Returns false (no side effect) when the session wasn't archived.
export const restore = id => {
    if (decisionsStore.load()[id]?.kind !== 'archive') return false;
    decisionsStore.save(id, { kind: 'hold', at: Date.now() });
    return true;
};

// Undo any lead decision (컨펌 취소 / 보류 해제).
export const undo = id => decisionsStore.clear(id);

export const openChat = session => openUrl(session.link);

// Archived sessions still archived (no newer activity), newest first.
export const listArchived = () => {
    const apps = loadAppSessions();
    const byCli = new Map(apps.map(a => [a.cliSessionId, a.sessionId]));
    const stateById = new Map(loadStates().map(st => [byCli.get(st.id) || st.id, st]));
    return Object.entries(decisionsStore.load())
        .filter(([id, d]) => d.kind === 'archive' && activeDecision(d, stateById.get(id)) === 'archive')
        .map(([id, d]) => ({ id, title: d.title || id, archivedAt: d.at, lastAt: d.lastAt || null, summary: d.summary || '' }))
        .sort((a, b) => b.archivedAt - a.archivedAt);
};
