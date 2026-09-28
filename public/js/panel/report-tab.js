import { $, escapeHtml } from '../lib/dom.js';
import { renderMarkdown } from '../lib/markdown.js';

const fullMessage = session => session.lastMessage
  ? `<details class="full-msg report-sec"><summary>전체 응답 보기</summary>${renderMarkdown(session.lastMessage)}</details>`
  : '';
export const renderReportPane = session => {
  const pane = $('#pane-report');
  const html = session.report
    ? Object.entries(session.report)
        .map(([heading, body]) => `<section class="report-sec"><h4>${escapeHtml(heading)}</h4>${renderMarkdown(body)}</section>`)
        .join('') + fullMessage(session)
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
