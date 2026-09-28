// App state shared across views/panel modules. No framework: plain mutable containers that
// modules read and mutate directly (matches the original script's style).
export const state = { sessionsById: new Map() };
export const selected = { id: null };
export const diffCache = new Map();
export const summaryLoadingIds = new Set();
export const activeTabState = { tab: 'report' };
// Header filter (views/filters.js FILTERS id). Not persisted: a reload starts from 'all'.
export const view = { filter: 'all' };
// Card being dragged on the board; set = board renders are skipped (moving DOM cancels the drag).
export const drag = { id: null };

// Small ref-cell registry: panel/footer.js and views/archive.js need to trigger an immediate
// poll or close the panel after an action, but importing main.js/panel.js directly for that
// would create a circular import. main.js and panel/panel.js fill these in at load time.
export const controls = {
  poll: () => {},
  closePanel: () => {},
};
