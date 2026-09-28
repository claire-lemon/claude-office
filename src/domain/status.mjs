// Pure status logic: no fs/child_process/Date.now/process.env. `now`-dependent state is passed in.

export const activeDecision = (decision, state) => (decision && decision.at > (state?.at || 0) ? decision.kind : null);

const DECISION_STATUS = { confirm: 'done', hold: 'hold', archive: 'archived' };
export const deriveStatus = ({ state, hasReport, decision }) => {
    const active = activeDecision(decision, state);
    if (active) return DECISION_STATUS[active];
    if (!state) return 'unknown';
    if (state.event === 'UserPromptSubmit') return 'working';
    if (state.event === 'Notification') return 'blocked';
    if (state.event === 'Stop') return hasReport ? 'review' : 'question';
    return 'unknown';
};

// Held sessions get a desk first (that is the point of holding); the rest fill up by recency.
export const seatAtDesks = (byRecency, maxDesks) =>
    [...byRecency.filter(s => s.active === 'hold'), ...byRecency.filter(s => s.active !== 'hold')]
        .slice(0, maxDesks)
        .sort((a, b) => b.lastAt - a.lastAt);
