// App state shared across views/panel modules. No framework: plain mutable containers that
// modules read and mutate directly (matches the original script's style).
export const state = { sessionsById: new Map() };
export const selected = { id: null };
export const diffCache = new Map();
export const summaryLoadingIds = new Set();
export const activeTabState = { tab: 'report' };
// Header filter (views/filters.js FILTERS id). Not persisted: a reload starts from 'all'.
// screen: 'office' | 'meeting' (views/meeting.js setScreen; the URL hash #meeting restores it).
export const view = { filter: 'all', screen: 'office' };
// Card being dragged on the board; set = board renders are skipped (moving DOM cancels the drag).
export const drag = { id: null };
// Today's todos from the last /api/todos poll (views/blackboard.js; board/panel read titles for 📋 tags).
export const todos = { list: [], deleted: [], folders: [] };
// Last GET /api/meeting (polled only on the meeting screen); null until the first answer.
export const meeting = { data: null };

// Small ref-cell registry: panel/footer.js and views/archive.js need to trigger an immediate
// poll or close the panel after an action, but importing main.js/panel.js directly for that
// would create a circular import. main.js and panel/panel.js fill these in at load time.
export const controls = {
  poll: () => {},
  closePanel: () => {},
  selectSession: () => {}, // views/blackboard.js opens a linked worker's panel
};
