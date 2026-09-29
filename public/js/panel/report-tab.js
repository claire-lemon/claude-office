import { $, escapeHtml } from '../lib/dom.js';
import { renderMarkdown, inlineMd } from '../lib/markdown.js';

const fullMessage = session => session.lastMessage
  ? `<details class="full-msg report-sec"><summary>전체 응답 보기</summary>${renderMarkdown(session.lastMessage)}</details>`
  : '';

// "다음 작업" gets a "▶ 진행" button per top-level item instead of plain markdown: session.nextTasks
// is the same parsed list the footer's split button uses, so each button fires the identical
// next:<index> action (see panel/actions.js, panel/footer.js). Falls back to markdown if parsing
// found nothing (keeps the section from going blank on an unexpected report shape).
const nextTasksHtml = session => {
  const tasks = session.nextTasks || [];
  if (!tasks.length) return null;
  const items = tasks.map((t, i) => `
    <li class="task-item">
      <div class="task-item-row">
        <span class="task-item-text">${inlineMd(t.title)}</span>
        <button type="button" class="act-btn task-next-btn" data-action="next:${i}" title="이 세션을 완료로 옮기고, 이 작업이 채워진 새 세션 입력창을 열어요">▶ 진행</button>
      </div>
      ${t.detail ? `<div class="task-item-detail">${renderMarkdown(t.detail)}</div>` : ''}
    </li>`).join('');
  return `<ol class="task-list">${items}</ol>`;
};

const sectionHtml = (session, heading, body) => {
  const html = heading === '다음 작업' ? nextTasksHtml(session) : null;
  return `<section class="report-sec"><h4>${escapeHtml(heading)}</h4>${html ?? renderMarkdown(body)}</section>`;
};

// Claude 앱이 턴마다 만드는 요약 (session.appSummary, from postTurnSummary): no model call of our own.
const appSummaryHtml = ({ detail, needsAction }) => `<section class="report-sec"><h4>앱 요약</h4>${renderMarkdown(detail)}${needsAction ? `<h4>필요한 조치</h4>${renderMarkdown(needsAction)}` : ''}<p class="hint">결재 보고 블록이 없어 Claude 앱이 만든 턴 요약을 보여줘요.</p></section>`;

// What the 보고서 tab shows, first one present: report -> 요약 만들기 result -> the app's turn summary ->
// the whole last reply. Pure (unit-tested); one row per source.
const REPORT_SOURCES = [
  ['report', s => s.report],
  ['summary', s => s.summary],
  ['appSummary', s => s.appSummary],
  ['lastMessage', s => s.lastMessage],
];
export const reportSource = session => REPORT_SOURCES.find(([, has]) => has(session))?.[0] ?? null;

const PANE_HTML = {
  report: s => Object.entries(s.report).map(([heading, body]) => sectionHtml(s, heading, body)).join('') + fullMessage(s),
  summary: s => `<section class="report-sec">${renderMarkdown(s.summary)}</section>${fullMessage(s)}`,
  appSummary: s => appSummaryHtml(s.appSummary) + fullMessage(s),
  lastMessage: s => `<section class="report-sec">${renderMarkdown(s.lastMessage)}<p class="hint">결재 보고 블록이 없어 마지막 응답 전체를 보여줘요. 정리가 필요하면 '요약 만들기'를 눌러보세요.</p></section>`,
};

export const renderReportPane = session => {
  const pane = $('#pane-report');
  const source = reportSource(session);
  const html = source ? PANE_HTML[source](session) : '<p class="hint">표시할 내용이 없어요.</p>';
  // Polling re-renders every 2s: skip identical HTML so scroll and open <details> survive.
  if (pane.dataset.html === html) return;
  const wasOpen = pane.querySelector('details.full-msg')?.open;
  pane.innerHTML = html;
  pane.dataset.html = html;
  const details = pane.querySelector('details.full-msg');
  if (details && wasOpen) details.open = true;
};
