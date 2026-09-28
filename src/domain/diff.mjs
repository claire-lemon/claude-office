// Pure diff text parsing: no fs/child_process/Date.now/process.env.

const STATUS_MARKERS = [
    [/^new file mode/m, 'added'],
    [/^deleted file mode/m, 'deleted'],
    [/^rename from /m, 'renamed'],
];
const statusOf = chunk => (STATUS_MARKERS.find(([re]) => re.test(chunk)) || [, 'modified'])[1];

// Added/removed line counts for one file's patch chunk, excluding the +++/--- file headers.
export const countLines = chunk =>
    chunk.split('\n').reduce(
        (acc, l) => {
            if (l.startsWith('+') && !l.startsWith('+++')) acc.add++;
            else if (l.startsWith('-') && !l.startsWith('---')) acc.del++;
            return acc;
        },
        { add: 0, del: 0 },
    );

export const isBinaryPatch = chunk => /^Binary files /m.test(chunk);

// Split a raw `git diff` patch into per-file chunks. `path`/`patch` meaning is unchanged from the
// original diffFor (backward compatible); status/add/del/binary are new fields alongside them.
export const splitPatch = patch =>
    String(patch || '')
        .split(/^diff --git /m)
        .filter(Boolean)
        .map(chunk => {
            const { add, del } = countLines(chunk);
            return {
                path: chunk.split('\n')[0].split(' b/').pop(),
                patch: `diff --git ${chunk}`,
                status: statusOf(chunk),
                add,
                del,
                binary: isBinaryPatch(chunk),
            };
        });
