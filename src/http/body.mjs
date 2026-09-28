// readJsonBody(req, { limit }) -> { ok: true, value } | { ok: false, code, error }.
// Requiring application/json means another site can't send this without a CORS preflight (on top of the Origin check).
export const readJsonBody = (req, { limit = 4096 } = {}) =>
    new Promise(resolve => {
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            req.resume();
            return resolve({ ok: false, code: 415, error: 'json only' });
        }
        const chunks = [];
        const onData = chunk => {
            chunks.push(chunk);
            if (chunks.reduce((n, c) => n + c.length, 0) <= limit) return;
            // Stop buffering but keep draining, so the 413 still reaches the client.
            req.off('data', onData).off('end', onEnd).resume();
            resolve({ ok: false, code: 413, error: 'too large' });
        };
        const onEnd = () => {
            try {
                resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            } catch {
                resolve({ ok: false, code: 400, error: 'bad json' });
            }
        };
        req.on('data', onData).on('end', onEnd).on('error', () => resolve({ ok: false, code: 400, error: 'bad request' }));
    });
