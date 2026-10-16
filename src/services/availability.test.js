const test = require('node:test');
const assert = require('node:assert/strict');
const {
    checkStreamsWithUserAddons, buildStreamIds, addonSupportsType
} = require('./stremio');
const { shouldNotifyNoSources } = require('./streamChecker');

function fakeResponse(streams, status = 200) {
    return { ok: status === 200, status, json: async () => ({ streams }) };
}

function directManifest(name) {
    return { id: name, name, resources: ['stream'], version: '1.0.0' };
}

test('generic stream resources work without a manifest types list', () => {
    assert.equal(addonSupportsType(directManifest('generic'), 'movie'), true);
    assert.equal(addonSupportsType(directManifest('generic'), 'series'), true);
    assert.equal(addonSupportsType({ types: ['movie'], resources: ['stream'] }, 'series'), false);
});

test('episode candidates prioritize actual monitored seasons and keep S01E01 fallback', () => {
    const media = { type: 'series', checkEpisodes: [
        { season_number: 1, episode_number: 1, monitored: 1 },
        { season_number: 2, episode_number: 1, monitored: 0 },
        { season_number: 3, episode_number: 1, monitored: 1 }
    ] };
    assert.deepEqual(buildStreamIds(media, 'tt1234567'), ['tt1234567:3:1', 'tt1234567:1:1']);
    assert.deepEqual(buildStreamIds({ type: 'series' }, 'tt1234567'), ['tt1234567:1:1']);
    assert.deepEqual(buildStreamIds({ type: 'movie' }, 'tt1234567'), ['tt1234567']);
});

test('series check finds streams for S03E01 when the first season is empty', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const manifestUrl = 'https://season-three.example/test/manifest.json';
    const requested = [];
    global.fetch = async (url) => {
        requested.push(String(url));
        if (String(url) === manifestUrl) return { ok: true, json: async () => directManifest('episode-addon') };
        if (String(url) === 'https://season-three.example/test/stream/series/tt1234567%3A3%3A1.json') {
            return fakeResponse([{ title: '1080p FRENCH', url: 'https://cdn.example/stream.mp4' }]);
        }
        return fakeResponse([]);
    };
    const result = await checkStreamsWithUserAddons({
        title: 'Series', type: 'series', imdb_id: 'tt1234567',
        checkEpisodes: [{ season_number: 3, monitored: 1 }]
    }, null, null, null, [manifestUrl]);
    assert.equal(result.available, true);
    assert.equal(result.conclusive, true);
    assert.equal(result.streamCount, 1);
    assert.deepEqual(requested, [manifestUrl, 'https://season-three.example/test/stream/series/tt1234567%3A3%3A1.json']);
});

test('HTTP errors are incomplete checks, not confirmed no-source alerts', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const manifestUrl = 'https://unavailable-addon.example/manifest.json';
    global.fetch = async (url) => {
        if (String(url) === manifestUrl) return { ok: true, json: async () => directManifest('broken-addon') };
        return fakeResponse([], 503);
    };
    const result = await checkStreamsWithUserAddons(
        { title: 'Movie', type: 'movie', imdb_id: 'tt1234567' }, null,
        null, null, [manifestUrl]
    );
    assert.equal(result.conclusive, false);
    assert.equal(result.checkStatus, 'incomplete');
    assert.equal(shouldNotifyNoSources(result), false);
});

test('truly empty successful responses can notify, but insufficient thresholds cannot', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const manifestUrl = 'https://empty-addon.example/manifest.json';
    let streams = [];
    global.fetch = async (url) => String(url) === manifestUrl
        ? { ok: true, json: async () => directManifest('empty-addon') }
        : fakeResponse(streams);
    const media = { title: 'Movie', type: 'movie', imdb_id: 'tt1234567' };
    const empty = await checkStreamsWithUserAddons(media, null, null, null, [manifestUrl]);
    assert.equal(empty.conclusive, true);
    assert.equal(empty.available, false);
    assert.equal(shouldNotifyNoSources(empty), true);

    streams = [{ url: 'https://video.example/a', title: '1080p' }];
    const insufficient = await checkStreamsWithUserAddons(
        media, null, null, null, [manifestUrl], { minStreamCount: 2, minAddonCount: 1 }
    );
    assert.equal(insufficient.conclusive, true);
    assert.equal(insufficient.streamCount, 1);
    assert.equal(insufficient.available, false);
    assert.equal(shouldNotifyNoSources(insufficient), false);
});

test('no IMDB ID never triggers no-source notification', async () => {
    const result = await checkStreamsWithUserAddons({ type: 'movie', title: 'Unknown' }, null);
    assert.equal(result.conclusive, false);
    assert.equal(shouldNotifyNoSources(result), false);
});

test('simultaneous additions share direct manifests and limit stream fetch concurrency', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const manifestUrl = 'https://parallel-addon.example/manifest.json';
    let manifestRequests = 0;
    let active = 0;
    let peak = 0;
    global.fetch = async (url) => {
        if (String(url) === manifestUrl) {
            manifestRequests++;
            return { ok: true, json: async () => directManifest('shared-addon') };
        }
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 3));
        active--;
        return fakeResponse([]);
    };
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        checkStreamsWithUserAddons({ title: `Movie ${i}`, type: 'movie', imdb_id: `tt${1000000 + i}` },
            null, null, null, [manifestUrl])));
    assert.equal(results.length, 12);
    assert.equal(manifestRequests, 1);
    assert.ok(peak <= 4, `stream concurrency should be capped at 4, got ${peak}`);
});
