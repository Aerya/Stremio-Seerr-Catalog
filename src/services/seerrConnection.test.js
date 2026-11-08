const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const { testSeerrConnection, handleSeerrConnectionTest } = require('./seerrConnection');

async function serve(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

test('validates the key on a protected endpoint and preserves the base path', async t => {
    const paths = [];
    const url = await serve(t, (req, res) => {
        paths.push(req.url);
        assert.equal(req.headers['x-api-key'], 'valid==');
        res.end(JSON.stringify(req.url.endsWith('/status') ? { version: '3.5.1' } : {}));
    });
    const result = await testSeerrConnection({ url: url + '/seerr/', apiKey: ' valid== ' });
    assert.equal(result.apiKeyValidated, true);
    assert.deepEqual(paths, ['/seerr/api/v1/status', '/seerr/api/v1/settings/main']);
});

test('without a key, reports connectivity only', async t => {
    const url = await serve(t, (req, res) => {
        assert.equal(req.url, '/api/v1/status');
        res.end('{"version":"3.5.1"}');
    });
    assert.equal((await testSeerrConnection({ url })).apiKeyValidated, false);
});

for (const status of [401, 403, 500]) {
    test(`protected endpoint HTTP ${status} fails the test`, async t => {
        const url = await serve(t, (req, res) => {
            if (req.url.endsWith('/status')) return res.end('{"version":"3.5.1"}');
            res.writeHead(status).end('{}');
        });
        await assert.rejects(testSeerrConnection({ url, apiKey: 'bad' }), {
            code: status === 500 ? 'SEERR_HTTP_ERROR' : 'SEERR_AUTH_FAILED'
        });
    });
}

for (const body of ['<html>login</html>', '{}', 'null']) {
    test(`rejects unexpected status response: ${body}`, async t => {
        const url = await serve(t, (_req, res) => res.end(body));
        await assert.rejects(testSeerrConnection({ url }));
    });
}

test('rejects invalid URLs and unsupported protocols', async () => {
    for (const url of ['', 'bad', 'ftp://localhost', 'http://user:password@localhost']) {
        await assert.rejects(testSeerrConnection({ url }), { code: 'INVALID_URL' });
    }
});

test('handles timeout, connection reset and interrupted responses', async t => {
    for (const behavior of ['timeout', 'reset', 'partial']) {
        const url = await serve(t, (req, res) => {
            if (behavior === 'reset') req.socket.destroy();
            if (behavior === 'partial') {
                res.writeHead(200); res.write('{');
                setTimeout(() => res.destroy(), 10);
            }
        });
        await assert.rejects(testSeerrConnection({ url }, 50),
            behavior === 'timeout' ? { code: 'SEERR_TIMEOUT' } : undefined);
    }
});

test('timeout handler sends exactly one HTTP response', async t => {
    const url = await serve(t, () => {});
    const replies = [];
    const res = {
        status(code) { this.code = code; return this; },
        json(body) { replies.push({ code: this.code, body }); }
    };
    await handleSeerrConnectionTest({ body: { url } }, res);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].code, 504);
    assert.equal(replies[0].body.code, 'SEERR_TIMEOUT');
});

function settingsContext(fetch) {
    const html = fs.readFileSync(require.resolve('../../public/index.html'), 'utf8');
    assert.equal((html.match(/async function saveJellyseerrSettings\(/g) || []).length, 1);
    const elements = {};
    const context = {
        fetch, setTimeout() {}, console,
        document: { getElementById(id) { return elements[id] ||= { value: 'test', style: {}, textContent: '' }; } }
    };
    vm.createContext(context);
    vm.runInContext(html.slice(html.indexOf('    async function fetchJellyseerrSettings'),
        html.indexOf('    // Stremio Configuration')), context);
    return { context, elements };
}

test('expired session does not report a successful save', async () => {
    const { context, elements } = settingsContext(async () => ({ status: 401, ok: false }));
    await context.saveJellyseerrSettings();
    assert.match(elements['jellyseerr-status'].textContent, /session has expired/);
    assert.doesNotMatch(elements['jellyseerr-status'].textContent, /saved/);
});

test('failed key save is displayed even when URL save succeeded', async () => {
    let calls = 0;
    const { context, elements } = settingsContext(async () => ++calls === 1
        ? { status: 200, ok: true }
        : { status: 500, ok: false, json: async () => ({ error: 'Save failed' }) });
    await context.saveJellyseerrSettings();
    assert.match(elements['jellyseerr-status'].textContent, /Save failed/);
});

test('successful save and test display success', async () => {
    const { context, elements } = settingsContext(async () => ({
        status: 200, ok: true, json: async () => ({ message: 'API key validated' })
    }));
    await context.saveJellyseerrSettings();
    assert.match(elements['jellyseerr-status'].textContent, /saved/);
    await context.testJellyseerrConnection();
    assert.match(elements['jellyseerr-status'].textContent, /API key validated/);
});

test('test distinguishes an expired Catalog session from Seerr rejecting a key', async () => {
    for (const status of [401, 502]) {
        const { context, elements } = settingsContext(async () => ({
            status, ok: false, json: async () => ({ error: 'Seerr rejected the API key' })
        }));
        await context.testJellyseerrConnection();
        assert.match(elements['jellyseerr-status'].textContent,
            status === 401 ? /session has expired/ : /Seerr rejected the API key/);
    }
});
