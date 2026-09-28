// ALL fetch('/api/...') calls live here as small functions. Each returns the raw fetch Promise
// (not parsed/checked) so callers keep their existing res.ok / res.json() handling unchanged.
// Imports nothing.
export const getSessions = () => fetch('/api/sessions', { cache: 'no-store' });
export const getDiff = id => fetch(`/api/diff/${encodeURIComponent(id)}`);
export const postConfirm = id => fetch(`/api/confirm/${encodeURIComponent(id)}`, { method: 'POST' });
export const postNext = (id, index) => fetch(`/api/next/${encodeURIComponent(id)}?index=${index}`, { method: 'POST' });
export const postHold = id => fetch(`/api/hold/${encodeURIComponent(id)}`, { method: 'POST' });
export const postArchive = id => fetch(`/api/archive/${encodeURIComponent(id)}`, { method: 'POST' });
export const postRestore = id => fetch(`/api/restore/${encodeURIComponent(id)}`, { method: 'POST' });
export const postUndo = id => fetch(`/api/undo/${encodeURIComponent(id)}`, { method: 'POST' });
export const postOpen = id => fetch(`/api/open/${encodeURIComponent(id)}`, { method: 'POST' });
export const postSummary = id => fetch(`/api/summary/${encodeURIComponent(id)}`, { method: 'POST' });
export const getArchived = () => fetch('/api/archived');
