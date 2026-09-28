// Pure report parsing: no fs/child_process/Date.now/process.env.

export const parseReport = text => {
    const idx = text.search(/^## 결재 보고\s*$/m);
    if (idx < 0) return null;
    const body = text.slice(idx).split('\n').slice(1).join('\n');
    const end = body.search(/^## /m);
    const block = end < 0 ? body : body.slice(0, end);
    return Object.fromEntries(
        block
            .split(/^### /m)
            .slice(1)
            .map(sec => {
                const [head, ...rest] = sec.split('\n');
                return [head.trim(), rest.join('\n').trim()];
            }),
    );
};

// "### 다음 작업" numbered items -> [{ title, detail }]; indented lines become the item's detail.
export const parseTasks = text =>
    String(text || '')
        .split('\n')
        .reduce((acc, line) => {
            const top = line.match(/^(?:\d+[.)]|[-*])\s+(.*)$/);
            if (top) return [...acc, { title: top[1].trim(), detail: [] }];
            if (acc.length && line.trim()) acc[acc.length - 1].detail.push(line.trim().replace(/^(?:\d+[.)]|[-*])\s+/, ''));
            return acc;
        }, [])
        .map(t => ({ title: t.title, detail: t.detail.join('\n') }));

// One line for the archive list: the report's 한 줄 요약, else the start of the last reply.
export const oneLineSummary = session =>
    String(session.report?.['한 줄 요약'] || session.preview || session.lastMessage || '')
        .split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
        .find(Boolean)
        ?.slice(0, 160) || '';
