// 결재함 columns and drag wording as data (docs/specs/2026-09-28-board-interactions-design.md §3, §4).
// Pure tables, no DOM: board.js builds the column markup from COLUMNS, board-dnd.js reads the
// MOVE_* tables. Which column a session is in and where it may go come from the server
// (session.column / session.moves, src/domain/board.mjs); a new column is one row there and one here.

// 결재 대기 order: blocked first (it stalls a session), then reports, then questions.
const PENDING_ORDER = ['blocked', 'review', 'question'];
const pendingRank = s => {
  const i = PENDING_ORDER.indexOf(s.status);
  return i < 0 ? PENDING_ORDER.length : i;
};

// sort?: card comparator. headerAction?: button in the column head, shown only while the column
// has cards; its id is the DOM id main.js's click handler matches.
export const COLUMNS = [
  { id: 'working', label: '작업 중' },
  { id: 'pending', label: '결재 대기', sort: (a, b) => pendingRank(a) - pendingRank(b) },
  { id: 'hold', label: '보류' },
  { id: 'done', label: '완료', headerAction: { id: 'archive-done', label: '모두 아카이브' } },
];

// Keyed by the server move action (src/domain/board.mjs MOVE_RULES): drop-zone label while
// dragging, and the toast after a successful drop.
export const MOVE_HINT = { hold: '보류로', confirm: '완료로 (상태만)', undo: '되돌리기' };
export const MOVE_TOAST = { hold: '보류로 옮겼어요', confirm: '완료로 옮겼어요 · 커밋·PR은 컨펌 버튼으로', undo: '원래 칸으로 되돌렸어요' };
