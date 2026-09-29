// 오늘 일지 AI 서술 (daily-narrative design): the model tells the 어제 sessions as one story into today's note,
// once a day after NARRATE_HOUR (server timer) or on demand (CLI `narrate`, 회의실 [지금 쓰기]). `run` is the
// model call.
import { NARRATE_HOUR } from '../config.mjs';
import * as notes from '../sources/daily-notes.mjs';
import { firstPromptText, lastAssistantText } from '../sources/transcripts.mjs';
import { narrativeInput, narrativeSection, replaceNarrative, narrationDue, localDate, startOfYesterday } from '../domain/daily-note.mjs';
import { NARRATIVE_SYSTEM } from '../domain/prompts.mjs';
import { runSummarizer } from '../platform/claude-cli.mjs';
import { refreshNote, recentWork } from './meeting.mjs';
import { listTodos } from './todos.mjs';

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
    // The note's 할 일 기록, so sessions of one 칠판 할 일 are told as one piece of work.
    const { history } = listTodos(now, { since });
    // No sessions -> no model call; the section still goes in so the timer stops for the day.
    const body = sessions.length ? await run(narrativeInput({ since, sessions, todos: history }), NARRATIVE_SYSTEM, NARRATE_TIMEOUT) : '';
    const date = localDate(now);
    // Read again after the model call: a 회의 n section may have been appended meanwhile.
    const section = narrativeSection({ at: now, since, count: sessions.length, body });
    return { note: notes.write(date, replaceNarrative(notes.read(date), section, date)), sessions: sessions.length };
};

const isDue = now => narrationDue({ now, text: notes.read(localDate(now)), hour: NARRATE_HOUR });

// Null when it is too early or the note already has its AI 서술.
export const narrateIfDue = async (now = Date.now(), run = runSummarizer) => (isDue(now) ? narrateNote(now, run) : null);

// ── In-server runs (finishing design §2.1): one at a time, the 회의실 polls this state ──

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

// 회의실 [지금 쓰기] / [다시 쓰기]: returns at once; a run already going (button or timer) is not doubled.
export const narrateInBackground = (now = Date.now(), run = runSummarizer) => {
    const already = narrationState.running;
    if (!already) runLocked(now, () => narrateNote(now, run));
    return { running: true, already };
};

// Server timer: skips while a run is going, else narrateIfDue under the same lock (not due = no run at all,
// so startedAt keeps the last real start).
export const narrateOnTimer = (now = Date.now(), run = runSummarizer) =>
    narrationState.running || !isDue(now) ? null : runLocked(now, () => narrateNote(now, run));
