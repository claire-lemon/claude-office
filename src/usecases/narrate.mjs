// 업무일지 (daily-narrative design): today's note gets an auto block of the 어제 sessions, and the model tells
// them as one story once a day after NARRATE_HOUR (server timer) or on demand (CLI `narrate`, the 📓 업무일지
// dialog's [지금 쓰기]). `run` is the model call.
import fs from 'node:fs';
import path from 'node:path';
import { NARRATE_HOUR, HOME } from '../config.mjs';
import * as notes from '../sources/daily-notes.mjs';
import * as decisionsStore from '../sources/decisions.mjs';
import * as overridesStore from '../sources/overrides.mjs';
import { firstPromptText, lastAssistantText } from '../sources/transcripts.mjs';
import { columnOf } from '../domain/board.mjs';
import { ANIMALS, hash, tilde } from '../domain/session-view.mjs';
import { autoSection, replaceAuto, narrativeInput, narrativeSection, replaceNarrative, narrationDue, narrativeOf, localDate, startOfYesterday } from '../domain/daily-note.mjs';
import { NARRATIVE_SYSTEM } from '../domain/prompts.mjs';
import { runSummarizer } from '../platform/claude-cli.mjs';
import { collectCandidates, transcriptOf, listSessions } from './list-sessions.mjs';

// Off-board session view: what the note needs of a session that left the board (it never reads git).
const LEAN_STATUS = { archive: 'archived', confirm: 'done' };
const lean = ({ cli, state, app, id, active, lastAt }, decisions, overrides) => {
    const status = LEAN_STATUS[active] || 'stale';
    return {
        id,
        title: overrides[id]?.title || app?.title || path.basename(app?.cwd || state?.cwd || '') || cli.slice(0, 8),
        animal: ANIMALS[hash(id) % ANIMALS.length],
        status,
        column: columnOf(status),
        lastAt,
        decidedAt: active ? decisions[id].at : null,
    };
};

// Sessions active since yesterday 00:00 (on the board or not), newest first: { view (board view, else lean),
// transcript, folder }.
export const recentWork = (now = Date.now()) => {
    const since = startOfYesterday(now);
    const board = new Map(listSessions(now).map(s => [s.id, s]));
    const decisions = decisionsStore.load();
    const overrides = overridesStore.load();
    return collectCandidates({ decisions })
        .filter(c => c.lastAt >= since)
        .sort((a, b) => b.lastAt - a.lastAt)
        .map(c => ({
            view: board.get(c.id) ?? lean(c, decisions, overrides),
            transcript: transcriptOf(c),
            folder: c.app?.originCwd || c.app?.cwd || c.state?.cwd || '',
        }));
};

// Rebuilds the note's auto block (yesterday 00:00 onward) and keeps the rest.
export const refreshNote = (now = Date.now()) => {
    const date = localDate(now);
    const since = startOfYesterday(now);
    const sessions = recentWork(now).map(w => ({ ...w.view, folder: w.folder }));
    return notes.write(date, replaceAuto(notes.read(date), autoSection({ since, sessions }), date));
};

// 16 real sessions took 95s (the summarizer's 60s is too short). Stays under NARRATE_EVERY so two timer runs
// never overlap.
const NARRATE_TIMEOUT = 300000;

export const narrateNote = async (now = Date.now(), run = runSummarizer) => {
    refreshNote(now);
    const since = startOfYesterday(now);
    const sessions = recentWork(now).map(({ view, transcript, folder }) => ({
        ...view,
        folder,
        prompt: firstPromptText(transcript),
        outcome: lastAssistantText(transcript),
    }));
    // No sessions -> no model call; the section still goes in so the timer stops for the day.
    const body = sessions.length ? await run(narrativeInput({ since, sessions }), NARRATIVE_SYSTEM, NARRATE_TIMEOUT) : '';
    const date = localDate(now);
    // Read again after the model call: the note may have been edited by hand meanwhile.
    const section = narrativeSection({ at: now, since, count: sessions.length, body });
    return { note: notes.write(date, replaceNarrative(notes.read(date), section, date)), sessions: sessions.length };
};

const isDue = now => narrationDue({ now, text: notes.read(localDate(now)), hour: NARRATE_HOUR });

// Null when it is too early or the note already has its AI 서술.
export const narrateIfDue = async (now = Date.now(), run = runSummarizer) => (isDue(now) ? narrateNote(now, run) : null);

// ── In-server runs (finishing design §2.1): one at a time, the 📓 업무일지 dialog polls this state ──

// ponytail: one module-level lock for the whole server; the CLI `narrate` is another process and ignores it.
export const narrationState = { running: false, startedAt: null, error: null };
const current = { promise: Promise.resolve() };

// Never rejects: the error lands in narrationState (and one stderr line), so nothing is left unhandled.
const runLocked = (now, task) => {
    Object.assign(narrationState, { running: true, startedAt: now });
    current.promise = task()
        .then(() => {
            narrationState.error = null;
        })
        .catch(e => {
            narrationState.error = e.message;
            console.error(`narrative not written: ${e.message}`);
        })
        .finally(() => {
            narrationState.running = false;
        });
    return current.promise;
};

// The last started run; resolves when it is over (tests).
export const waitNarration = () => current.promise;

// 📓 [지금 쓰기] / [다시 쓰기]: returns at once; a run already going (button or timer) is not doubled.
export const narrateInBackground = (now = Date.now(), run = runSummarizer) => {
    const already = narrationState.running;
    if (!already) runLocked(now, () => narrateNote(now, run));
    return { running: true, already };
};

// Server timer: skips while a run is going, else narrateIfDue under the same lock (not due = no run at all,
// so startedAt keeps the last real start).
export const narrateOnTimer = (now = Date.now(), run = runSummarizer) =>
    narrationState.running || !isDue(now) ? null : runLocked(now, () => narrateNote(now, run));

// GET /api/journal: today's note and its AI 서술 with the in-server run's state. display = the office's home as ~.
export const getJournal = (now = Date.now()) => {
    const date = localDate(now);
    const file = notes.pathFor(date);
    return {
        date,
        note: { path: file, display: tilde(file, HOME), exists: fs.existsSync(file) },
        narrative: { ...narrativeOf(notes.read(date), date), running: narrationState.running, startedAt: narrationState.startedAt, error: narrationState.error },
    };
};
