// Pure event-history derivations (docs/specs/2026-09-29-event-history-design.md §4). events: [{ event, at }]
// oldest first as the hook appended them; state: the current hook state ({ event, at } | null).

// When the session started waiting on the lead: the first event of the trailing run of the current event
// (two permission prompts in a row wait since the first). History that doesn't end at the current state
// (lines missing, no history yet) -> state.at, the same as before there was a history.
export const pendingSince = (events, state) => {
    if (!state) return null;
    const last = events[events.length - 1];
    if (!last || last.at !== state.at || last.event !== state.event) return state.at;
    return events[events.findLastIndex(e => e.event !== state.event) + 1].at;
};

// The last finished turn: last Stop minus the first UserPromptSubmit of the prompts that led to it (those after
// the Stop before them). A Stop that continues without a prompt (a Stop hook kept it going) stays in the same
// turn. null if no prompt came before the last Stop.
export const lastTurnMs = events => {
    const stop = events.findLastIndex(e => e.event === 'Stop');
    const prompt = events.findLastIndex((e, i) => i < stop && e.event === 'UserPromptSubmit');
    if (prompt < 0) return null;
    const prevStop = events.findLastIndex((e, i) => i < prompt && e.event === 'Stop');
    return events[stop].at - events.find((e, i) => i > prevStop && e.event === 'UserPromptSubmit').at;
};
