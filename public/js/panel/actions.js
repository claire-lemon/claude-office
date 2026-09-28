// Pure function: session -> footer action layout. No DOM, no imports (see docs/specs
// 2026-09-28-layering-and-panel-design.md §6.2, 2026-09-28-board-interactions-design.md §5.0).
// Node-importable for unit tests.
//
// actionsFor(session) -> {
//   primary: { id, label, kind?: 'split', options?: [{ id, label }] } | null,  // row 1
//   secondary: { id, label } | null,                                          // row 1
//   extra: [{ id, label, kind?: 'danger' }],                                  // row 2, danger last
// }
// A new button = one entry here + one row in footer.js's ACTION_HANDLERS.

const OPEN = { id: 'open', label: '채팅방 열기' };
const SUMMARY = { id: 'summary', label: '요약 만들기' };
const HOLD = { id: 'hold', label: '보류' };
const CONFIRM = { id: 'confirm', label: '컨펌 · 커밋·PR' };
const UNDO_HOLD = { id: 'undo', label: '보류 해제' };
const UNDO_CONFIRM = { id: 'undo', label: '컨펌 취소' };
const ARCHIVE = { id: 'archive', label: '아카이브', kind: 'danger' };

const nextOptionLabel = (task, position) => `${position}번 진행 · ${task.title}`;

// 결재 대기 (review/question/blocked). Only 'review' with next tasks gets the split primary;
// question/blocked always fall through to the plain "컨펌 · 커밋·PR" primary (§6.2 table).
const pendingActions = session => {
  const tasks = (session.nextTasks || []).slice(0, 3);
  if (session.status === 'review' && tasks.length > 0) {
    const options = tasks.slice(1).map((t, i) => ({ id: `next:${i + 1}`, label: nextOptionLabel(t, i + 2) }));
    return {
      primary: { id: 'next:0', label: 'OK · 1번 진행', kind: 'split', options },
      extra: [CONFIRM, SUMMARY, HOLD, ARCHIVE],
    };
  }
  return { primary: CONFIRM, extra: [SUMMARY, HOLD, ARCHIVE] };
};

const STATUS_ACTIONS = {
  review: pendingActions,
  question: pendingActions,
  blocked: pendingActions,
  working: () => ({ primary: null, extra: [HOLD, ARCHIVE] }),
  hold: () => ({ primary: UNDO_HOLD, extra: [SUMMARY, ARCHIVE] }),
  done: () => ({ primary: null, extra: [UNDO_CONFIRM, ARCHIVE] }),
};

export const actionsFor = session => {
  // unknown (and any other unmapped status) behaves like working, per §6.2.
  const build = STATUS_ACTIONS[session.status] || STATUS_ACTIONS.working;
  const { primary, extra } = build(session);
  return { primary, secondary: session.link ? OPEN : null, extra };
};
