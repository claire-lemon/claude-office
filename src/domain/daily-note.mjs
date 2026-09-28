// Pure 오늘 일지 builders (meeting-room design §4): the server-owned auto block, the 회의 n section, and
// splicing them into a note without touching anything outside the markers. `now`-like values come in as
// arguments; dates are the server's local time.
import { oneLineSummary } from './report.mjs';

export const STATUS_LABEL = {
    working: '작업 중', review: '결재 대기', question: '질문 중', blocked: '막힘', hold: '보류',
    done: '완료', archived: '보관', stale: '지난 세션', unknown: '상태 미상',
};
// Copy of public/js/views/sprites.js ANIMAL_LABELS (browser module, not importable here).
export const ANIMAL_LABELS = {
    cat: '고양이', dog: '강아지', rabbit: '토끼', bear: '곰', penguin: '펭귄',
    fox: '여우', hamster: '햄스터', panda: '판다', duck: '오리', frog: '개구리',
};
const TODO_MARK = { open: '☐', started: '◐', done: '☑' };
export const AUTO_START = '<!-- office:auto:start -->';
export const AUTO_END = '<!-- office:auto:end -->';
const MESSAGE_LIMIT = 1200;

const pad = n => String(n).padStart(2, '0');
export const localDate = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const hhmm = ms => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Local midnight of the day before (the "어제 세션" window). Date arithmetic keeps DST days right.
export const startOfYesterday = now => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
};

// Code-point cut so Korean/emoji are never split; newlines flattened so the text stays one list item.
const oneLine = (text, max) => [...String(text || '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
const numbered = (lines, indent = '') => lines.map((l, i) => `${indent}${i + 1}. ${l}`);
const orNone = lines => (lines.length ? lines : ['없음']);

export const noteSkeleton = date => `---\ndate: "${date}"\ntype: office-daily\n---\n# ${date}\n`;

// session: { title, status, diffStat?, todoTitle?, report?, preview?, nextTasks? } (off-board ones: title/status only).
const sessionHead = s => {
    const stat = s.diffStat && `+${s.diffStat.add} −${s.diffStat.del} · ${s.diffStat.files}개 파일`;
    return [`${s.title} — ${STATUS_LABEL[s.status] ?? s.status}`, stat, s.todoTitle && `📋 ${s.todoTitle}`].filter(Boolean).join(' · ');
};
const sessionSubs = s => {
    const summary = oneLineSummary({ report: s.report }) || oneLine(s.preview, 120);
    const next = (s.nextTasks || []).map(t => t.title).join(' / ');
    return [summary && `한 줄 요약: ${summary}`, next && `다음 작업 추천: ${next}`].filter(Boolean);
};
const sessionItems = sessions => sessions.flatMap((s, i) => [`${i + 1}. ${sessionHead(s)}`, ...numbered(sessionSubs(s), '   ')]);

// todo: a TodoView. started = the latest session's animal + status chip, done = its time.
const todoExtra = ({ status, latest, doneAt }) =>
    status === 'started' && latest ? `${ANIMAL_LABELS[latest.animal] ?? latest.animal} ${STATUS_LABEL[latest.status] ?? STATUS_LABEL.unknown}`
        : status === 'done' && doneAt ? `완료 ${hhmm(doneAt)}`
            : '';
const todoLine = t => [`${TODO_MARK[t.status] ?? TODO_MARK.open} ${t.title} — ${t.project}`, todoExtra(t)].filter(Boolean).join(' · ');

export const autoSection = ({ since, sessions = [], todos = [], folders = [] }) =>
    [
        AUTO_START,
        `## 어제 세션 (${localDate(since)} ${hhmm(since)} 이후)`,
        ...(sessions.length ? sessionItems(sessions) : ['1. 없음']),
        '## 칠판 (지금)',
        ...numbered(orNone(todos.map(todoLine))),
        '## 최근 프로젝트 폴더',
        ...numbered(orNone(folders.map(f => `${f.name} — ${f.path}`))),
        AUTO_END,
    ].join('\n');

// Replace the marker block; else put it right after the first H1 (frontmatter + "# date"); else start a new
// note from the skeleton. Text outside the markers (회의 n sections, hand notes) is kept as is.
export const replaceAuto = (text, auto, date) => {
    const doc = text || '';
    const start = doc.indexOf(AUTO_START);
    const end = start < 0 ? -1 : doc.indexOf(AUTO_END, start);
    if (end >= 0) return doc.slice(0, start) + auto + doc.slice(end + AUTO_END.length);
    const h1 = doc.match(/^# .*$/m);
    if (!h1) return `${noteSkeleton(date)}\n${auto}\n${doc.trim() ? `\n${doc.trim()}\n` : ''}`;
    const at = h1.index + h1[0].length;
    const rest = doc.slice(at).replace(/^\n+/, '');
    return `${doc.slice(0, at)}\n\n${auto}\n${rest ? `\n${rest}` : ''}`;
};

export const meetingSection = ({ n, startedAt, endedAt, todos = [], lastMessage = '' }) => {
    const message = [...String(lastMessage || '').trim()].slice(0, MESSAGE_LIMIT).join('');
    const quoted = message ? ['2. 진행자 마지막 메시지', ...message.split('\n').map(l => `   > ${l}`.trimEnd())] : [];
    return [
        `## 회의 ${n} (${hhmm(startedAt)} ~ ${hhmm(endedAt)})`,
        `1. 오늘 할 일 확정 ${todos.length}개`,
        ...numbered(todos.map(todoLine), '   '),
        ...quoted,
    ].join('\n');
};

// Exactly one blank line between the note and the new section; the file ends with a newline.
export const appendSection = (text, section) => {
    const doc = String(text || '').replace(/\s+$/, '');
    return `${doc ? `${doc}\n\n` : ''}${section.replace(/\s+$/, '')}\n`;
};
