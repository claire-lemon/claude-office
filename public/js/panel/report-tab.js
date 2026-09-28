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
        <button type="button" class="act-btn task-next-btn" data-action="next:${i}">▶ 진행</button>
      </div>
      ${t.detail ? `<div class="task-item-detail">${renderMarkdown(t.detail)}</div>` : ''}
    </li>`).join('');
  return `<ol class="task-list">${items}</ol>`;
};

const sectionHtml = (session, heading, body) => {
  const html = heading === '다음 작업' ? nextTasksHtml(session) : null;
  return `<section class="report-sec"><h4>${escapeHtml(heading)}</h4>${html ?? renderMarkdown(body)}</section>`;
};

export const renderReportPane = session => {
  const pane = $('#pane-report');
  const html = session.report
    ? Object.entries(session.report).map(([heading, body]) => sectionHtml(session, heading, body)).join('') + fullMessage(session)
    : session.summary
      ? `<section class="report-sec">${renderMarkdown(session.summary)}</section>${fullMessage(session)}`
      : session.lastMessage
        ? `<section class="report-sec">${renderMarkdown(session.lastMessage)}<p class="hint">결재 보고 블록이 없어 마지막 응답 전체를 보여줘요. 정리가 필요하면 '요약 만들기'를 눌러보세요.</p></section>`
        : '<p class="hint">표시할 내용이 없어요.</p>';
  // Polling re-renders every 2s: skip identical HTML so scroll and open <details> survive.
  if (pane.dataset.html === html) return;
  const wasOpen = pane.querySelector('details.full-msg')?.open;
  pane.innerHTML = html;
  pane.dataset.html = html;
  const details = pane.querySelector('details.full-msg');
  if (details && wasOpen) details.open = true;
};
