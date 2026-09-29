// Pure 회의실 rules: the #meeting- marker, the facilitator's deep-link prompt, its CLAUDE.md guide and the
// 칠판 sync plan (its `### 칠판` list -> todo writes).
// No fs/child_process/Date.now/process.env.
import { normalizeTodoPatch } from './todo.mjs';

// The facilitator's first prompt line carries the marker; the server finds it in the transcript head
// (same idea as #todo-). id = <local date>-<n>, n = the day's meeting number.
export const MEETING_MARK = /#meeting-(\d{4}-\d{2}-\d{2}-\d+)\b/;
export const meetingId = (date, n) => `${date}-${n}`;
export const meetingMarker = id => `🏫 데일리 스크럼 #meeting-${id}`;
export const meetingIdIn = text => (typeof text === 'string' && text.match(MEETING_MARK)?.[1]) || null;

// Deep links cap the prompt at 2000 chars, so the instructions live in the folder's CLAUDE.md instead.
// The app may open the session in a scratch workspace instead of OFFICE_DIR (seen with a non-git
// folder), so the guide is named by absolute path and read first rather than relied on as CLAUDE.md.
export const meetingPrompt = (id, notePath, guidePath) =>
    [meetingMarker(id), `지침: ${guidePath}`, `오늘 일지: ${notePath}`, '지침 파일을 먼저 읽고 그대로 회의를 시작해줘. 지침과 일지 외의 파일은 읽지 마.'].join('\n');

// First line of CLAUDE.md. The server rewrites the guide only when this line differs, so hand edits
// survive until the version is bumped.
export const GUIDE_VERSION = 5;
export const GUIDE_HEADER = `<!-- claude-office guide v${GUIDE_VERSION} -->`;

// v3 (meeting-board-sync design §2.4): no CLI. The facilitator only talks; its `### 칠판` list is the day's
// todos and the server copies it onto the 칠판 (syncMeetingBoard), so silence still fills the board.
export const facilitatorGuide = () => `${GUIDE_HEADER}
# 데일리 스크럼 진행자 지침

이 폴더와 파일은 claude-office 대시보드가 관리한다. 첫 줄의 버전 표시가 바뀌면 서버가 이 파일을 다시 쓴다.

## 역할
1. 데일리 스크럼 진행자
   1. 어제 한 일을 정리하고 오늘 할 일을 정함
   2. 오늘 할 일은 답변 끝 \`### 칠판\` 목록으로만 적음 (대시보드가 몇 초 안에 칠판에 옮김)
2. 읽는 것은 세 가지뿐
   1. 이 지침 파일 (프롬프트의 \`지침:\` 경로)
   2. 프롬프트의 \`오늘 일지:\` 경로 파일 하나
   3. 사용자가 채팅에 쓴 말

## 금지
1. 지침·일지 외 파일 읽기 금지 (레포·볼트 조사 금지)
2. 파일 쓰기·수정 금지 (일지도 고치지 않음)
3. 명령 실행 금지 (Bash 도구를 쓰지 않음, ls·find·grep 포함)
4. git 금지
5. 웹 검색·웹 조회 금지

## 순서
1. 지침과 일지 읽기
   1. 앞선 \`## 회의 n\` 섹션이 있으면 그 결정을 이어받음
2. 첫 답변 (번호 목록)
   1. 어제 끝낸 일
   2. 못 끝낸 일: 오늘 이어갈 것은 칠판 목록에 넣음
   3. 오늘 추천: 항목마다 근거 한 줄
   4. 맨 끝에 \`### 칠판\`
3. 사용자가 말하면 조정
   1. 더하고 고치고 빼서 바뀐 목록 전체를 다시 씀
   2. 일지 \`## 칠판 (지금)\`에 있던 할 일을 빼 달라고 하면 칠판에서 직접 지우도록 안내
4. 사용자가 조용해도 그대로 둠
   1. 칠판에 이미 반영됨. 확인을 재촉하지 않음
5. 모든 답변은 지금의 \`### 칠판\` 목록 전체로 끝냄
   1. 결재 보고 형식은 쓰지 않음

## 칠판 형식
\`\`\`markdown
### 칠판
1. 결제 응답 파싱을 use-case로 옮기고 테스트 통과시키기 — api-server
   1. 배경: 컨트롤러에 파싱이 섞여 있어 PG를 바꿀 때마다 두 곳을 고침
   2. 할 일: 파싱 함수를 use-case로 이동, 호출부 정리
   3. 완료 기준: 기존 테스트 통과, 응답 필드 그대로
2. 회의록 정리본을 커밋하고 PR 올리기 — knowledge
\`\`\`
1. 한 줄 = \`N. <제목> — <폴더 이름>\` (제목과 폴더 사이는 앞뒤를 한 칸씩 띄운 긴 줄표 \` — \`)
2. 세부 메모는 3칸 들여쓴 하위 번호 목록 (없으면 생략)
3. 오늘 실제로 할 일만, 우선순위 순, 7개 이하
4. 같은 할 일 두 번 금지
   1. 일지 \`## 칠판 (지금)\`에 이미 있는 할 일은 넣지 않음 (칠판에 그대로 남음)
5. 목록에서 빼면 아직 시작 전인 할 일은 칠판에서도 지워짐
6. \`### 칠판\` 제목은 답변마다 한 번, 답변 맨 끝에

## 제목 쓰는 법
1. 제목만 읽어도 무엇을 해서 무엇을 끝내는지 알 수 있게 씀
   1. \`<무엇을> <어떻게> 하기\` 형태의 한 문장, 20~45자
   2. 끝나는 모습이 드러나게 (예: "…고치고 배포하기", "…정리해 공유하기")
2. 내부 코드·번호만으로 쓰지 않음
   1. 항목 번호(C3, B2 같은 것), PR·이슈 번호, 커밋 해시, 파일·브랜치 이름, 사람 이름은 제목에서 빼고 세부 메모로
   2. 코드의 뜻이 일지에 있으면 그 뜻을 제목에 씀. 뜻을 모르면 그 일의 대상과 결과로 씀
3. 제목에는 백틱·굵게 같은 꾸밈을 쓰지 않음
4. 예
   1. 나쁨 "C3 해석 통일 후 커밋·PR" → 좋음 "보고서 판정 기준을 하나로 맞추고 PR 올리기"
   2. 나쁨 "PR #12 리뷰 반영" → 좋음 "로그인 API 리뷰 코멘트를 반영해 다시 올리기"
   3. 나쁨 "deploy.sh 수정" → 좋음 "배포 스크립트의 권한 오류 고치기"

## 세부 메모 쓰는 법
1. 새 세션이 이 메모만 보고 시작할 수 있게 씀 (칠판 [시작]이 메모를 프롬프트에 넣음)
2. 하위 번호 목록 2~4줄
   1. 배경: 왜 하는지, 어디까지 됐는지
   2. 할 일: 구체적인 단계 (코드·번호·파일·브랜치 이름은 여기에)
   3. 완료 기준: 무엇을 확인하면 끝인지

## 폴더 고르기
1. 폴더 이름은 일지 \`## 최근 프로젝트 폴더\`의 이름(또는 절대 경로) 중 하나를 그대로 씀
   1. 어제 세션 줄 끝의 \`📁 이름\`이 그 일을 한 폴더
2. 맞는 폴더가 없으면 사용자에게 어느 폴더인지 묻고, 답을 들을 때까지 그 항목은 목록에서 뺌
   1. 사용자가 경로를 알려주면 그 절대 경로(\`/\`로 시작)를 폴더 자리에 그대로 씀
3. 홈 폴더 자체는 프로젝트 폴더가 아님 (목록에도 없음)
`;

// ── 칠판 sync (meeting-board-sync design §2.1-2.2): the facilitator's list -> a plan of todo writes ──

const BOARD_LIMIT = 7;
const BOARD_HEADING = /^#{2,4}\s*칠판\s*$/;
const TOP_ITEM = /^\d+[.)]\s+(.+)$/;
const SUB_ITEM = /^(?: {2,}|\t)(?:\d+[.)]|-)\s+(.+)$/;
const isListLine = l => TOP_ITEM.test(l) || SUB_ITEM.test(l);
// Models bold or code-quote names now and then: **제목**, `api`.
// Titles and folders are plain text on the 칠판: every backtick / bold mark goes (a title like
// "`name` 정리" used to keep its closing backtick when only the ends were stripped).
const unwrap = s => s.replace(/\*\*|`/g, '').trim();
// The last em dash splits title / folder (a title may hold one too); en dash or hyphen only without one.
const SEPARATORS = [' — ', ' – ', ' - '];
const splitItem = text => {
    const sep = SEPARATORS.find(s => text.includes(s));
    if (!sep) return { title: unwrap(text), folder: '' };
    const at = text.lastIndexOf(sep);
    return { title: unwrap(text.slice(0, at)), folder: unwrap(text.slice(at + sep.length)) };
};

export const normTitle = s =>
    String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/[\s.,·]+$/, '');

// The reply's last `### 칠판` section -> [{ title, folder, detail }] (first BOARD_LIMIT items). The list runs
// until the first non-list line (blank lines allowed in between); indented items are the detail lines.
// "1. 없음" (the note's own style) is no item. No section -> [].
export const boardItems = text => {
    const lines = String(text || '').split('\n').map(l => l.trimEnd());
    const head = lines.findLastIndex(l => BOARD_HEADING.test(l));
    if (head < 0) return [];
    const rest = lines.slice(head + 1);
    const end = rest.findIndex(l => l.trim() && !isListLine(l));
    const block = (end < 0 ? rest : rest.slice(0, end)).filter(l => l.trim());
    const starts = block.flatMap((l, i) => (TOP_ITEM.test(l) ? [i] : []));
    return starts
        .map((s, k) => ({
            ...splitItem(block[s].match(TOP_ITEM)[1]),
            detail: block.slice(s + 1, starts[k + 1] ?? block.length).map(l => l.match(SUB_ITEM)[1].trim()).join('\n'),
        }))
        .filter(item => !(item.folder === '' && normTitle(item.title) === '없음'))
        .slice(0, BOARD_LIMIT);
};

// folders = [{ path, name }]: an exact path, else one name (case-sensitive first) -> { path } | { reason }.
const resolveFolder = (folder, folders) => {
    const byPath = folders.find(f => f.path === folder);
    if (byPath) return { path: byPath.path };
    const exact = folders.filter(f => f.name === folder);
    const hits = exact.length ? exact : folders.filter(f => f.name.toLowerCase() === folder.toLowerCase());
    if (hits.length === 1) return { path: hits[0].path };
    return { reason: hits.length ? 'ambiguous folder' : 'unknown folder' };
};

// Compared the way the todo stores it, so an unchanged list never reads as an edit.
const cleanDetail = detail => normalizeTodoPatch({ detail: String(detail ?? '') }).patch?.detail ?? '';

// Dropped from the list but kept: started, checked, assigned or already gone.
const untouched = t => !t.deletedAt && t.status === 'open' && !t.manual && !t.assigned?.length && !t.sessions?.length;

// design §2.2. todos = today's 칠판 views plus this meeting's own (deleted too), with meeting / status /
// manual / assigned / sessions / deletedAt. -> { create: [{ title, folder, detail, key }], update: [{ id, patch }],
// remove: [id], skipped: [{ title, folder, reason }] }, creates in item order. key = normTitle of the listed title.
export const syncPlan = ({ meetingId, items, todos, folders }) => {
    const keyed = items
        .map(item => ({ ...item, key: normTitle(item.title), detail: cleanDetail(item.detail) }))
        .filter((item, i, all) => item.key && all.findIndex(x => x.key === item.key) === i);
    const mine = todos.filter(t => t.meeting?.id === meetingId);
    const steps = keyed.map(item => {
        const place = resolveFolder(item.folder, folders);
        const own = mine.find(t => t.meeting.key === item.key);
        // ponytail: a deleted one of ours stays deleted, also one the sync dropped and the list brings back (되돌리기
        // on the 칠판 restores it); record who deleted it if re-listing should restore.
        if (own) {
            if (own.deletedAt) return {};
            const patch = {
                ...(item.detail === (own.detail ?? '') ? {} : { detail: item.detail }),
                ...(place.path && place.path !== own.folder ? { folder: place.path } : {}),
            };
            return Object.keys(patch).length ? { update: { id: own.id, patch } } : {};
        }
        // The title is the user's once written, so a renamed one of ours counts as any other todo.
        if (todos.some(t => !t.deletedAt && normTitle(t.title) === item.key)) return {};
        if (!place.path) return { skipped: { title: item.title, folder: item.folder, reason: place.reason } };
        return { create: { title: item.title, folder: place.path, detail: item.detail, key: item.key } };
    });
    const keys = new Set(keyed.map(item => item.key));
    return {
        create: steps.flatMap(s => s.create ?? []),
        update: steps.flatMap(s => s.update ?? []),
        remove: mine.filter(t => !keys.has(t.meeting.key) && untouched(t)).map(t => t.id),
        skipped: steps.flatMap(s => s.skipped ?? []),
    };
};
