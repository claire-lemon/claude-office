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
export const postMove = (id, to) => fetch(`/api/move/${encodeURIComponent(id)}?to=${encodeURIComponent(to)}`, { method: 'POST' });
// JSON content-type is required by the server (blocks preflight-free cross-site posts).
export const postEdit = (id, patch) => fetch(`/api/edit/${encodeURIComponent(id)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
});
// Today's todos (blackboard, docs/specs/2026-09-28-todo-blackboard-design.md §8).
const jsonInit = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const getTodos = () => fetch('/api/todos', { cache: 'no-store' });
// 보관함 "지난 할 일" (docs/specs/2026-09-29-todo-history-design.md §3.6).
export const getTodoHistory = () => fetch('/api/todo-history', { cache: 'no-store' });
export const postTodo = body => fetch('/api/todos', jsonInit('POST', body));
export const patchTodo = (id, body) => fetch(`/api/todos/${encodeURIComponent(id)}`, jsonInit('POST', body));
export const deleteTodo = id => fetch(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const postStart = id => fetch(`/api/start/${encodeURIComponent(id)}`, { method: 'POST' });
// ✨ 다듬기: a proposed detail, never saved by this call (docs/specs/2026-09-29-finishing-touches-design.md §3).
export const postRefine = id => fetch(`/api/refine/${encodeURIComponent(id)}`, { method: 'POST' });
// 회의실 (docs/specs/2026-09-29-meeting-room-design.md §5).
export const getMeeting = () => fetch('/api/meeting', { cache: 'no-store' });
export const postMeetingStart = () => fetch('/api/meeting/start', { method: 'POST' });
export const postMeetingEnd = () => fetch('/api/meeting/end', { method: 'POST' });
// 업무일지 AI 서술: 202 at once, the meeting poll shows its progress (finishing-touches design §2).
export const postMeetingNarrate = () => fetch('/api/meeting/narrate', { method: 'POST' });
