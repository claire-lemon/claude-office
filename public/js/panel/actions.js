// Pure function: session -> footer action layout. No DOM, no imports (see docs/specs
// 2026-09-28-layering-and-panel-design.md §6.2, 2026-09-28-board-interactions-design.md §5.0).
// Node-importable for unit tests.
//
// actionsFor(session) -> {
//   primary: { id, label, hint, kind?: 'split', options?: [{ id, label, hint }] } | null,  // row 1
//   secondary: { id, label, hint } | null,                                               // row 1
//   extra: [{ id, label, hint, kind?: 'danger' }],                                       // row 2, danger last
// }
// hint = the button's tooltip: what pressing it actually does (footer.js puts it in title).
// A new button = one entry here + one row in footer.js's ACTION_HANDLERS.

const OPEN = { id: 'open', label: '채팅방 열기', hint: 'Claude 앱에서 이 세션의 채팅을 열어요' };
const SUMMARY = { id: 'summary', label: '요약 만들기', hint: '마지막 응답을 로컬 claude -p(haiku)로 요약해 보고서 탭에 보여줘요 (최대 60초)' };
const HOLD = { id: 'hold', label: '보류', hint: '보류 칸으로 옮기기만 해요. 세션에는 아무것도 보내지 않아요' };
const CONFIRM = { id: 'confirm', label: '컨펌 · 커밋·PR', hint: '이 세션을 완료로 옮기고, 커밋 → PR 지시문을 클립보드에 복사한 뒤 채팅방을 열어요. 붙여넣기(⌘V)와 Enter는 직접 눌러요' };
const UNDO_HOLD = { id: 'undo', label: '보류 해제', hint: '보류 전 칸으로 되돌려요' };
const UNDO_CONFIRM = { id: 'undo', label: '컨펌 취소', hint: '완료 전 칸으로 되돌려요. 이미 보낸 커밋·PR은 되돌리지 않아요' };
const ARCHIVE = { id: 'archive', label: '아카이브', kind: 'danger', hint: '사무실과 결재함에서 빼요. 🗄️ 보관함에서 복구할 수 있어요' };

const nextOptionLabel = (task, position) => `${position}번 진행 · ${task.title}`;
const nextHint = position => `이 세션을 완료로 옮기고, ${position}번 작업이 채워진 새 세션 입력창을 열어요. Enter는 직접 눌러요`;

// 결재 대기 (review/question/blocked). Only 'review' with next tasks gets the split primary;
// question/blocked always fall through to the plain "컨펌 · 커밋·PR" primary (§6.2 table).
const pendingActions = session => {
  const tasks = (session.nextTasks || []).slice(0, 3);
  if (session.status === 'review' && tasks.length > 0) {
    const options = tasks.slice(1).map((t, i) => ({ id: `next:${i + 1}`, label: nextOptionLabel(t, i + 2), hint: nextHint(i + 2) }));
    return {
      primary: { id: 'next:0', label: 'OK · 1번 진행', hint: nextHint(1), kind: 'split', options },
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
