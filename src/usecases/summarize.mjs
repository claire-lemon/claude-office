// summarize(session): build the summarizer input from the transcript + changes, run it, persist it.
import { lastAssistantText } from '../sources/transcripts.mjs';
import * as summaries from '../sources/summaries.mjs';
import { SUMMARY_SYSTEM } from '../domain/prompts.mjs';
import { getChanges } from './get-changes.mjs';
import { runSummarizer } from '../platform/claude-cli.mjs';

export const summarize = async session => {
    const d = getChanges(session);
    const input = [
        `세션 제목: ${session.title}`,
        '<transcript>',
        lastAssistantText(session.transcript || '') || session.preview || '(응답 없음)',
        '</transcript>',
        `<changes>\n${d.stat || '변경 없음'}\n${(d.files || []).map(f => f.path).join('\n')}\n</changes>`,
        '위 세션을 결재 보고 포맷으로 요약하라.',
    ].join('\n');
    const out = await runSummarizer(input, SUMMARY_SYSTEM);
    summaries.write(session.id, out);
    return out;
};
