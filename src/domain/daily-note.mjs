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
// 칠판 marks by todo status; deleted is for 할 일 기록 heads only (not the #todo- regex in domain/todo.mjs).
const TODO_MARK = { open: '☐', started: '◐', done: '☑', deleted: '✕' };
export const AUTO_START = '<!-- office:auto:start -->';
export const AUTO_END = '<!-- office:auto:end -->';
export const NARRATIVE_START = '<!-- office:narrative:start -->';
export const NARRATIVE_END = '<!-- office:narrative:end -->';
const MESSAGE_LIMIT = 1200;
const PROMPT_LIMIT = 800; // narrator input per session: the request's head
const OUTCOME_LIMIT = 2000; // ...and the last reply's tail (결재 보고 sits at the end)

const pad = n => String(n).padStart(2, '0');
export const localDate = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const hhmm = ms => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const mmdd = ms => {
    const d = new Date(ms);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const stamp = ms => `${mmdd(ms)} ${hhmm(ms)}`;
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

// ── 할 일 기록 (todo-history design §3.2-3.3): a todo with every session it went through ──

// One linked session: animal, title, status, and its decision time (else its last activity).
export const historyLine = s => `${ANIMAL_LABELS[s.animal] ?? s.animal} ${s.title} — ${STATUS_LABEL[s.status] ?? s.status} · ${stamp(s.decidedAt ?? s.lastAt)}`;
// view.sessions is newest first; the history reads oldest first.
export const todoHistory = view => [...(view.sessions || [])].sort((a, b) => a.lastAt - b.lastAt).map(historyLine);
const historyHead = t => {
    const count = t.sessions?.length || 0;
    return [
        `${t.deletedAt ? TODO_MARK.deleted : TODO_MARK[t.status] ?? TODO_MARK.open} ${t.title} — ${t.project}`,
        t.status === 'done' && t.doneAt && `완료 ${stamp(t.doneAt)}`,
        t.deletedAt && `삭제 ${stamp(t.deletedAt)}`,
        count > 0 && `세션 ${count}개`,
    ].filter(Boolean).join(' · ');
};
const historyItems = todos => todos.flatMap((t, i) => [`${i + 1}. ${historyHead(t)}`, ...numbered(todoHistory(t), '   ')]);

// history = TodoViews touched since `since` (deleted ones too), oldest first.
export const autoSection = ({ since, sessions = [], todos = [], folders = [], history = [] }) =>
    [
        AUTO_START,
        `## 어제 세션 (${localDate(since)} ${hhmm(since)} 이후)`,
        ...(sessions.length ? sessionItems(sessions) : ['1. 없음']),
        '## 칠판 (지금)',
        ...numbered(orNone(todos.map(todoLine))),
        `## 할 일 기록 (${localDate(since)} ${hhmm(since)} 이후)`,
        ...(history.length ? historyItems(history) : ['1. 없음']),
        '## 최근 프로젝트 폴더',
        ...numbered(orNone(folders.map(f => `${f.name} — ${f.path}`))),
        AUTO_END,
    ].join('\n');

// The start..end marker block swapped for `block`; null when the doc has no such block.
const swapBlock = (doc, start, end, block) => {
    const s = doc.indexOf(start);
    const e = s < 0 ? -1 : doc.indexOf(end, s);
    return e < 0 ? null : doc.slice(0, s) + block + doc.slice(e + end.length);
};
// `block` as its own paragraph right after doc[0..at).
const insertAt = (doc, at, block) => {
    const rest = doc.slice(at).replace(/^\n+/, '');
    return `${doc.slice(0, at)}\n\n${block}\n${rest ? `\n${rest}` : ''}`;
};

// Replace the marker block; else put it right after the first H1 (frontmatter + "# date"); else start a new
// note from the skeleton. Text outside the markers (AI 서술, 회의 n sections, hand notes) is kept as is.
export const replaceAuto = (text, auto, date) => {
    const doc = text || '';
    const swapped = swapBlock(doc, AUTO_START, AUTO_END, auto);
    if (swapped !== null) return swapped;
    const h1 = doc.match(/^# .*$/m);
    if (!h1) return `${noteSkeleton(date)}\n${auto}\n${doc.trim() ? `\n${doc.trim()}\n` : ''}`;
    return insertAt(doc, h1.index + h1[0].length, auto);
};

// ── AI 서술 (daily-narrative design): the narrator's input, its section, where it sits in the note ──

const head = (text, max) => [...String(text || '').trim()].slice(0, max).join('');
const tail = (text, max) => {
    const chars = [...String(text || '').trim()];
    return chars.length > max ? `…${chars.slice(-max).join('')}` : chars.join('');
};

// session: a SessionView (or lean one) + folder, prompt (first request), outcome (last reply).
const narrativeItem = (s, i) =>
    [
        `<session n="${i + 1}">`,
        `제목: ${s.title}`,
        `상태: ${STATUS_LABEL[s.status] ?? s.status} · 마지막 활동 ${localDate(s.lastAt)} ${hhmm(s.lastAt)}`,
        s.folder && `폴더: ${s.folder}${s.branch ? ` (브랜치 ${s.branch})` : ''}`,
        s.prs?.length && `PR: ${s.prs.map(p => p.url || `#${p.number}`).join(', ')}`,
        s.diffStat && `변경: +${s.diffStat.add} −${s.diffStat.del} · ${s.diffStat.files}개 파일`,
        s.todoTitle && `칠판 할 일: ${s.todoTitle}`,
        `요청:\n${head(s.prompt, PROMPT_LIMIT) || '(없음)'}`,
        `마지막 응답:\n${tail(s.outcome, OUTCOME_LIMIT) || '(없음)'}`,
        '</session>',
    ]
        .filter(Boolean)
        .join('\n');

// Oldest first so the narrator reads the day in order (the auto block lists newest first). todos = the same
// 할 일 기록 items, so sessions that went into one 칠판 할 일 read as one piece of work.
export const narrativeInput = ({ since, sessions, todos = [] }) =>
    [
        `기간: ${localDate(since)} ${hhmm(since)} 이후, 세션 ${sessions.length}개 (오래된 순)`,
        '<sessions>',
        ...[...sessions].sort((a, b) => a.lastAt - b.lastAt).map(narrativeItem),
        '</sessions>',
        ...(todos.length ? ['<todos>', ...historyItems(todos), '</todos>'] : []),
        '위 세션들로 업무일지의 어제 이야기를 써라.',
    ].join('\n');

// body = model output. Our markers in it would break the next splice and an H1/H2 would read as a note
// section, so both are neutralised.
export const narrativeSection = ({ at, since, count, body }) => {
    const text = String(body || '').replace(/<!--\s*office:[^>]*-->/g, '').replace(/^#{1,2} /gm, '### ').trim();
    return [
        NARRATIVE_START,
        `## 어제 이야기 (AI 서술 · ${localDate(since)} ${hhmm(since)} 이후 세션 ${count}개 · ${hhmm(at)} 작성)`,
        text || '1. 없음',
        NARRATIVE_END,
    ].join('\n');
};

// Replace the block; else right after the auto block; else at the end (a note without an auto block).
export const replaceNarrative = (text, section, date) => {
    const doc = text || '';
    const swapped = swapBlock(doc, NARRATIVE_START, NARRATIVE_END, section);
    if (swapped !== null) return swapped;
    const auto = doc.indexOf(AUTO_END);
    if (auto >= 0) return insertAt(doc, auto + AUTO_END.length, section);
    return appendSection(doc || noteSkeleton(date), section);
};

// The 회의실 업무일지 card (finishing design §2.1): the block's body (heading kept, markers dropped) and its
// "HH:MM 작성" read as that local day's time. date = 'YYYY-MM-DD'.
export const narrativeOf = (noteText, date) => {
    const doc = String(noteText || '');
    const s = doc.indexOf(NARRATIVE_START);
    const e = s < 0 ? -1 : doc.indexOf(NARRATIVE_END, s);
    if (e < 0) return { exists: false, text: '', writtenAt: null };
    const text = doc.slice(s + NARRATIVE_START.length, e).trim();
    const time = text.split('\n')[0].match(/(\d{1,2}):(\d{2}) 작성/);
    const [y, m, d] = date.split('-').map(Number);
    return { exists: true, text, writtenAt: time ? new Date(y, m - 1, d, Number(time[1]), Number(time[2])).getTime() : null };
};

// Once a day: after `hour` (local) and only while the note has no AI 서술 yet.
export const narrationDue = ({ now, text, hour }) => new Date(now).getHours() >= hour && !String(text || '').includes(NARRATIVE_START);

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
