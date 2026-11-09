const test = require('node:test');
const assert = require('node:assert/strict');
const remix = require('./remixIntegration');
const { checkStreamsWithUserAddons } = require('./stremio');

function fakeDb() {
    const settings = new Map();
    const snapshots = new Map();
    return {
        settings, snapshots,
        getSetting: key => settings.get(key) || null,
        setSetting: (key, value) => settings.set(key, value),
        clearRemixSnapshots: () => snapshots.clear(),
        saveRemixSnapshot: (id, payload) => snapshots.set(id, payload)
    };
}

const media = { id: 7, type: 'movie', imdb_id: 'tt0133093', tmdb_id: 603, user_id: 3, title: 'The Matrix', year: 1999 };
const check = {
    available: true, conclusive: true, streamCount: 3, addonsCount: 2,
    lastChecked: '2026-11-09T17:00:00.000Z', requirements: { minStreamCount: 2, minAddonCount: 2 }
};

test('integration is disabled by default and requires a long shared token', () => {
    const db = fakeDb();
    assert.equal(remix.getSettings(db).enabled, false);
    assert.equal(remix.bearerAuthorized(db, 'Bearer irrelevant'), false);
    assert.throws(() => remix.updateSettings(db, { enabled: true }), /token/i);
    assert.throws(() => remix.updateSettings(db, { token: 'short', enabled: true }), /32/);
    assert.equal(remix.getSettings(db).enabled, false);
    const key = remix.generateToken(db);
    assert.equal(key.length, 64);
    assert.equal(remix.getSettings(db).tokenConfigured, true);
    assert.equal(JSON.stringify(remix.getSettings(db)).includes(key), false);
    remix.updateSettings(db, { enabled: true });
    assert.equal(remix.bearerAuthorized(db, `Bearer ${key}`), true);
    assert.equal(remix.bearerAuthorized(db, `Bearer ${'f'.repeat(64)}`), false);
    remix.updateSettings(db, { enabled: false });
    assert.equal(remix.bearerAuthorized(db, `Bearer ${key}`), false);
});

test('settings URL validation is atomic and disabling clears cached sensitive streams', () => {
    const db = fakeDb();
    const key = remix.generateToken(db);
    remix.updateSettings(db, { enabled: true, webhookUrl: 'https://remix.example/api/integrations/seerrcatalog/v1/events' });
    db.snapshots.set(7, {});
    assert.throws(() => remix.updateSettings(db, { enabled: false, webhookUrl: 'file:///etc/passwd' }), /HTTP/);
    assert.equal(remix.getSettings(db).enabled, true);
    assert.equal(remix.bearerAuthorized(db, `Bearer ${key}`), true);
    assert.equal(db.snapshots.size, 1);
    remix.updateSettings(db, { enabled: false });
    assert.equal(db.snapshots.size, 0);
});

test('snapshots preserve status but expire credentials before status, and skip inconclusive checks', () => {
    const payload = remix.snapshot(media, { ...check, remixReleases: [{ streamId: 'tt0133093' }] });
    assert.equal(payload.schema, 'seerrcatalog.availability.v1');
    assert.deepEqual(payload.media, {
        id: 7, userId: 3, type: 'movie', imdbId: 'tt0133093', tmdbId: 603, title: 'The Matrix', year: 1999
    });
    assert.equal(payload.releases.length, 1);
    const early = remix.activeSnapshot(payload, Date.parse('2026-11-09T17:05:00Z'));
    assert.equal(early.releases.length, 1);
    const later = remix.activeSnapshot(payload, Date.parse('2026-11-09T17:31:00Z'));
    assert.equal(later.available, true);
    assert.deepEqual(later.releases, []);
    assert.equal(remix.activeSnapshot(payload, Date.parse('2026-11-10T19:00:01Z')), null);
    assert.equal(remix.snapshot(media, { ...check, conclusive: false }), null);
    assert.deepEqual(remix.snapshot(media, { ...check, available: false, remixReleases: [{}] }).releases, []);
});

test('stable torrent hashes remain reusable after a signed URL expires', () => {
    const hash = 'a'.repeat(40);
    const payload = remix.snapshot(media, { ...check, remixReleases: [{
        addonId: 'one', streamId: 'tt0133093',
        stream: { infoHash: hash, url: 'https://private.example/?token=sensitive', fileIdx: 2 }
    }] });
    const old = remix.activeSnapshot(payload, Date.parse('2026-11-09T17:40:00Z'));
    assert.equal(old.releases[0].stream.infoHash, hash);
    assert.equal(old.releases[0].stream.fileIdx, 2);
    assert.equal(JSON.stringify(old).includes('token=sensitive'), false);
});

test('exports supported stream descriptors without blindly persisting addon payloads', () => {
    const addon = { id: 'example.streams', name: 'Example' };
    const value = remix.exportRelease({
        url: 'https://stream.example/path?token=secret', infoHash: 'A'.repeat(40),
        fileIdx: 2, behaviorHints: { filename: 'The.Matrix.mkv', proxyHeaders: {
            request: { Authorization: 'Bearer token', Host: 'forbidden-header-by-remix', 'Bad\nHeader': 'evil' }
        } },
        maliciousAddonProperty: 'never export'
    }, addon, 'tt0133093', { name: 'Release', quality: '1080p', size: '2 GB' });
    assert.equal(value.stream.url, 'https://stream.example/path?token=secret');
    assert.equal(value.stream.infoHash, 'a'.repeat(40));
    assert.equal(value.stream.fileIdx, 2);
    assert.equal(value.stream.behaviorHints.proxyHeaders.request.Authorization, 'Bearer token');
    assert.equal(value.stream.maliciousAddonProperty, undefined);
    assert.equal(value.stream.behaviorHints.proxyHeaders.request['Bad\nHeader'], undefined);
    assert.equal(remix.exportRelease({ url: 'javascript:alert(1)' }, addon, 'x', {}), null);
});

test('stream checks pass series episode identity and never serialize protected stream URLs in ordinary results', async t => {
    const previousFetch = global.fetch;
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async url => String(url).endsWith('manifest.json')
        ? { ok: true, json: async () => ({ id: 'addon', name: 'Addon', resources: ['stream'] }) }
        : { ok: true, json: async () => ({ streams: [{
            url: 'https://video.example/private?token=secret',
            title: 'FRENCH 1080p', behaviorHints: { filename: 'Show.S03E01.mkv' }
        }] }) };
    const result = await checkStreamsWithUserAddons({
        type: 'series', title: 'Show', imdb_id: 'tt0000123', checkEpisodes: [{ season_number: 3, monitored: 1 }]
    }, null, null, null, ['https://example.org/manifest.json'], null, true);
    assert.equal(result.remixReleases[0].streamId, 'tt0000123:3:1');
    assert.equal(result.remixReleases[0].stream.url, 'https://video.example/private?token=secret');
    assert.equal(JSON.stringify(result).includes('private?token'), false);
});

test('push event uses shared token and cannot interrupt availability on network failure', async () => {
    const db = fakeDb();
    const key = remix.generateToken(db);
    remix.updateSettings(db, { enabled: true, webhookUrl: 'https://remix.example/events' });
    const requests = [];
    const ok = await remix.sendEvent(db, 'availability.updated', { available: true }, async (url, options) => {
        requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return { ok: true };
    });
    assert.equal(ok, true);
    assert.equal(requests[0].headers.Authorization, `Bearer ${key}`);
    assert.equal(requests[0].body.schema, remix.SCHEMA);
    const failed = await remix.sendEvent(db, 'availability.updated', {}, async () => { throw new Error('offline'); });
    assert.equal(failed, false);
});
