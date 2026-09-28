// 오늘 일지 AI 서술 (daily-narrative design): the model tells the 어제 sessions as one story into today's note,
// once a day after NARRATE_HOUR (server timer) or on demand (CLI `narrate`). `run` is the model call.
import { NARRATE_HOUR } from '../config.mjs';
import * as notes from '../sources/daily-notes.mjs';
import { firstPromptText, lastAssistantText } from '../sources/transcripts.mjs';
import { narrativeInput, narrativeSection, replaceNarrative, narrationDue, localDate, startOfYesterday } from '../domain/daily-note.mjs';
import { NARRATIVE_SYSTEM } from '../domain/prompts.mjs';
import { runSummarizer } from '../platform/claude-cli.mjs';
import { refreshNote, recentWork } from './meeting.mjs';

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
    // Read again after the model call: a 회의 n section may have been appended meanwhile.
    const section = narrativeSection({ at: now, since, count: sessions.length, body });
    return { note: notes.write(date, replaceNarrative(notes.read(date), section, date)), sessions: sessions.length };
};

// Server timer entry: null when it is too early or the note already has its AI 서술.
export const narrateIfDue = async (now = Date.now(), run = runSummarizer) =>
    narrationDue({ now, text: notes.read(localDate(now)), hour: NARRATE_HOUR }) ? narrateNote(now, run) : null;
