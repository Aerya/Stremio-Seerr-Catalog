const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const remix = require('../services/remixIntegration');

function fixture() {
    const settings = new Map();
    const entries = new Map();
    const db = {
        getRemixRevision: () => 1,
        entries, getSetting: key => settings.get(key) || null,
        setSetting: (key, value) => settings.set(key, value),
        clearRemixSnapshots: () => entries.clear(),
        getRemixSnapshotsAfter: (after, limit) => [...entries.entries()]
            .filter(([id]) => id > after).sort((a, b) => a[0] - b[0]).slice(0, limit)
            .map(([id, payload]) => ({ id, payload }))
    };
    const handlers = new Map();
    const fakeExpress = {
        Router: () => Object.fromEntries(['get', 'post', 'put'].map(method => [method, (route, ...callbacks) => {
            handlers.set(`${method.toUpperCase()} ${route}`, callbacks);
        }]))
    };
    const context = { module: { exports: {} }, require(spec) {
        if (spec === 'express') return fakeExpress;
        if (spec === '../services/remixIntegration') return remix;
        throw new Error(spec);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'remix.js'), 'utf8'), context, { filename: 'remix.js' });
    context.module.exports.createRouter(db);

    async function call(method, route, req = {}) {
        const response = { statusCode: 200, headers: {}, payload: undefined,
            status(code) { this.statusCode = code; return this; },
            json(value) { this.payload = value; return this; },
            set(key, value) { this.headers[key.toLowerCase()] = value; return this; }
        };
        for (const fn of handlers.get(`${method} ${route}`)) {
            let proceed = false;
            await fn({ headers: {}, query: {}, ...req }, response, () => { proceed = true; });
            if (!proceed) break;
        }
        return response;
    }
    return { db, call };
}

test('snapshot endpoint rejects unauthenticated and disabled requests', async () => {
    const { db, call } = fixture();
    const token = remix.generateToken(db);
    assert.equal((await call('GET', '/v1/availability')).statusCode, 401);
    assert.equal((await call('GET', '/v1/availability', {
        headers: { authorization: `Bearer ${token}` }
    })).statusCode, 401);
    remix.updateSettings(db, { enabled: true });
    assert.equal((await call('GET', '/v1/availability', {
        headers: { authorization: 'Bearer wrong' }
    })).statusCode, 401);
});

test('read-only snapshot feed paginates and drops expired stream credentials', async () => {
    const { db, call } = fixture();
    const token = remix.generateToken(db);
    remix.updateSettings(db, { enabled: true });
    for (const id of [3, 8]) db.entries.set(id, {
        schema: remix.SCHEMA, media: { id }, available: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        releasesExpireAt: new Date(Date.now() - 1000).toISOString(),
        releases: [{ stream: { url: 'https://private.example/token' } }]
    });
    const headers = { authorization: `Bearer ${token}` };
    const first = await call('GET', '/v1/availability', { headers, query: { after: '0', limit: '1' } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.payload.items.length, 1);
    assert.deepEqual(first.payload.items[0].releases, []);
    assert.equal(first.payload.nextCursor, 3);
    const second = await call('GET', '/v1/availability', { headers, query: { after: '3', limit: '50' } });
    assert.equal(second.payload.items[0].media.id, 8);
    assert.equal(second.payload.nextCursor, null);
    assert.equal((await call('GET', '/v1/availability', { headers, query: { limit: '200' } })).statusCode, 400);
});

test('only administrator sessions may edit settings or rotate tokens', async () => {
    const { db, call } = fixture();
    assert.equal((await call('GET', '/settings')).statusCode, 403);
    assert.equal((await call('POST', '/token')).statusCode, 403);
    const generated = await call('POST', '/token', { user: { is_admin: 1 } });
    const token = generated.payload.token;
    assert.equal(token.length, 64);
    const config = await call('GET', '/settings', { user: { is_admin: 1 } });
    assert.equal(config.payload.tokenConfigured, true);
    assert.equal(JSON.stringify(config.payload).includes(token), false);
    assert.equal(db.getSetting('ether_remix_token'), token);
});
