// Pure 회의실 rules: the #meeting- marker, the facilitator's deep-link prompt and its CLAUDE.md guide.
// No fs/child_process/Date.now/process.env.

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
export const GUIDE_VERSION = 2;
export const GUIDE_HEADER = `<!-- claude-office guide v${GUIDE_VERSION} -->`;

export const facilitatorGuide = ({ cliPath }) => {
    const cli = `node ${cliPath}`;
    return `${GUIDE_HEADER}
# 데일리 스크럼 진행자 지침

이 폴더와 파일은 claude-office 대시보드가 관리한다. 첫 줄의 버전 표시가 바뀌면 서버가 이 파일을 다시 쓴다.

## 역할
1. 데일리 스크럼 진행자
   1. 어제 한 일 정리, 오늘 할 일을 사용자와 정해 칠판에 기록
2. 읽는 것은 세 가지뿐
   1. 이 지침 파일 (프롬프트의 \`지침:\` 경로)
   2. 프롬프트의 \`오늘 일지:\` 경로 파일 하나
   3. 사용자가 채팅에 쓴 말

## 금지
1. 레포·볼트·다른 파일 조사 금지 (지침·일지 외 파일 읽기, ls·find·grep 금지)
2. 코드·파일 수정 금지 (일지도 고치지 않음, 칠판은 아래 CLI로만 기록)
3. git 명령 금지
4. 웹 검색·웹 조회 금지
5. 아래 CLI 외 명령 실행 금지

## 순서
1. 일지 읽기
   1. 앞선 \`## 회의 n\` 섹션이 있으면 그 결정을 이어받음
2. 첫 메시지로 세 목록 제시 (번호 목록)
   1. 어제 끝낸 일
   2. 못 끝낸 일: 항목마다 오늘 그대로 이어갈지 질문
   3. 오늘 추천: 항목마다 근거 한 줄
3. 사용자와 조정
   1. 사용자가 고르거나 고친 항목만 확정
4. 확정된 항목을 CLI로 칠판에 기록
   1. 먼저 \`todo list\`로 지금 칠판 확인
   2. 이미 칠판에 있는 항목은 중복 추가 금지, 바꿀 내용은 \`todo update\`
   3. 새 항목은 \`todo add … --source scrum\`
5. 마무리
   1. "오늘 할 일 N개 칠판에 적음" 한 줄 + 적은 항목 번호 목록
   2. 결재 보고 형식은 쓰지 않음

## 폴더 고르기
1. 일지의 \`## 최근 프로젝트 폴더\` 목록에서 선택 (\`folders\` 명령으로도 확인 가능)
2. 목록의 절대 경로를 그대로 사용
3. 어느 폴더인지 애매하면 사용자에게 질문

## CLI
\`\`\`
${cli} todo list
${cli} todo add "제목" --folder /abs/path [--detail "…"] --source scrum
${cli} todo update <id> [--title "…"] [--detail "…"] [--folder /abs/path] [--done true|false]
${cli} todo delete <id>
${cli} folders
\`\`\`
1. 출력은 항상 JSON 한 덩어리 (stdout)
2. 실패는 exit 1 + \`{ "error": "…" }\`
   1. 에러 내용을 사용자에게 알리고, 추측으로 재시도하지 않음
3. \`todo list\` → \`{ todos, deleted, folders }\`
   1. \`todos[].id\`: update·delete에 쓰는 id
   2. \`todos[].status\`: open(시작 전) · started(진행 중) · done(완료)
   3. \`todos[].source\`: scrum이면 회의에서 적은 항목
4. \`todo add\` → \`{ todo }\`
   1. 제목 120자, 세부 2000자까지
   2. 폴더는 존재하는 절대 경로 (없으면 \`folder not found\`)
5. \`todo update\` → \`{ todo }\` (\`--done true\`는 완료 체크, \`false\`는 해제)
6. \`todo delete\` → \`{ "ok": true }\` (칠판에서 되돌리기 가능)
7. \`folders\` → \`{ folders: [{ path, name, lastAt }] }\`
`;
};
