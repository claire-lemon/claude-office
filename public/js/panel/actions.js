// Pure function: session -> footer action layout. No DOM, no imports (see docs/specs
// 2026-09-28-layering-and-panel-design.md §5/§6.2). Node-importable for unit tests.
//
// actionsFor(session) -> {
//   primary: { id, label, kind?: 'split', options?: [{ id, label }] } | null,
//   secondary: { id, label } | null,
//   overflow: [{ id, label, kind?: 'danger'|'separator' }],
// }

const OPEN = { id: 'open', label: '채팅방 열기' };
const SUMMARY = { id: 'summary', label: '요약 만들기' };
const HOLD = { id: 'hold', label: '보류' };
const CONFIRM = { id: 'confirm', label: '컨펌 · 커밋·PR' };
const UNDO_HOLD = { id: 'undo', label: '보류 해제' };
const UNDO_CONFIRM = { id: 'undo', label: '컨펌 취소' };
const SEPARATOR = { id: 'separator', kind: 'separator' };
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
      overflow: [CONFIRM, SUMMARY, HOLD, SEPARATOR, ARCHIVE],
    };
  }
  return { primary: CONFIRM, overflow: [SUMMARY, HOLD, SEPARATOR, ARCHIVE] };
};

const STATUS_ACTIONS = {
  review: pendingActions,
  question: pendingActions,
  blocked: pendingActions,
  working: () => ({ primary: null, overflow: [HOLD, SEPARATOR, ARCHIVE] }),
  hold: () => ({ primary: UNDO_HOLD, overflow: [SUMMARY, SEPARATOR, ARCHIVE] }),
  done: () => ({ primary: null, overflow: [UNDO_CONFIRM, SEPARATOR, ARCHIVE] }),
};

export const actionsFor = session => {
  // unknown (and any other unmapped status) behaves like working, per §6.2.
  const build = STATUS_ACTIONS[session.status] || STATUS_ACTIONS.working;
  const { primary, overflow } = build(session);
  return { primary, secondary: session.link ? OPEN : null, overflow };
};
