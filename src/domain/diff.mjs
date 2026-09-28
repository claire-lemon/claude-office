// Pure diff text parsing: no fs/child_process/Date.now/process.env.

// Split a raw `git diff` patch into per-file chunks. Moved as-is from diffFor; output identical.
export const splitPatch = patch =>
    patch
        .split(/^diff --git /m)
        .filter(Boolean)
        .map(chunk => ({ path: chunk.split('\n')[0].split(' b/').pop(), patch: `diff --git ${chunk}` }));
