const test = require('node:test');
const assert = require('node:assert/strict');

const {
    checkStreamsWithUserAddons,
    normalizeManifestUrl,
    buildResourceUrl,
    filterStreamsByLanguage,
    filterStreamsByResolution,
    isMeaningfulStream,
    evaluateAvailability
} = require('./stremio');

test('buildResourceUrl preserves configured addon path and builds Stremio stream endpoint', () => {
    const manifest = 'https://example.test/config-token==/manifest.json';
    assert.equal(
        buildResourceUrl(manifest, 'stream', 'movie', 'tt0133093'),
        'https://example.test/config-token==/stream/movie/tt0133093.json'
    );
    assert.equal(normalizeManifestUrl('https://example.test/config-token=='), manifest);
});

test('filters inspect all standard Stremio metadata fields, not only the first populated field', () => {
    const streams = [{
        name: 'Lumio · FRENCH',
        title: '1080p WEB-DL',
        description: 'Indexer result',
        url: 'https://video.example/movie.mp4',
        behaviorHints: { filename: 'Movie.2026.WEB-DL.mkv' }
    }];

    assert.equal(filterStreamsByLanguage(streams, ['FRENCH']).length, 1);
    assert.equal(filterStreamsByResolution(streams, '1080p').length, 1);
});

test('muted addon error streams are not counted as releases', () => {
    assert.equal(isMeaningfulStream({
        title: 'Error: No releases found',
        url: 'data:video/mp4;base64,AAAA'
    }), false);

    assert.equal(isMeaningfulStream({
        title: '1080p MULTI',
        infoHash: '0123456789abcdef'
    }), true);
});

test('availability can require multiple releases or multiple distinct addons', () => {
    const oneAddon = [{ id: 'addon.one', name: 'One', streamCount: 2 }];
    assert.equal(evaluateAvailability(2, oneAddon, { minStreamCount: 2, minAddonCount: 1 }).available, true);
    assert.equal(evaluateAvailability(2, oneAddon, { minStreamCount: 1, minAddonCount: 2 }).available, false);

    const twoAddons = [
        { id: 'addon.one', name: 'One', streamCount: 1 },
        { id: 'addon.two', name: 'Two', streamCount: 1 }
    ];
    assert.equal(evaluateAvailability(2, twoAddons, { minStreamCount: 1, minAddonCount: 2 }).available, true);
});

test('direct-only addon works without a Stremio auth key and keeps filters/thresholds', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    const manifestUrl = 'https://lumio.example/profile-token/manifest.json';
    const expectedStreamUrl = 'https://lumio.example/profile-token/stream/movie/tt0133093.json';
    const requested = [];

    global.fetch = async (url) => {
        requested.push(String(url));
        if (String(url) === manifestUrl) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'community.lumio.stream',
                    version: '1.0.6',
                    name: 'Lumio · Salon',
                    resources: ['stream'],
                    types: ['movie', 'series'],
                    idPrefixes: ['tt']
                })
            };
        }

        if (String(url) === expectedStreamUrl) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    streams: [
                        {
                            name: 'Lumio · FRENCH',
                            title: '1080p WEB-DL',
                            description: 'Release from provider A',
                            url: 'https://video.example/a.mp4',
                            behaviorHints: { filename: 'Movie.2026.WEB-DL.mkv' }
                        },
                        {
                            name: 'Lumio · MULTI',
                            title: '2160p WEB-DL',
                            description: 'Release from provider B',
                            url: 'https://video.example/b.mp4',
                            behaviorHints: { filename: 'Movie.2026.UHD.mkv' }
                        }
                    ]
                })
            };
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await checkStreamsWithUserAddons(
        { title: 'The Matrix', type: 'movie', imdb_id: 'tt0133093' },
        null,
        null,
        { languageTags: ['FRENCH'], minResolution: '1080p' },
        [manifestUrl],
        { minStreamCount: 1, minAddonCount: 1 }
    );

    assert.deepEqual(requested, [manifestUrl, expectedStreamUrl]);
    assert.equal(result.available, true);
    assert.equal(result.streamCount, 1);
    assert.equal(result.addonsCount, 1);
    assert.equal(result.addons[0].name, 'Lumio · Salon');
    assert.deepEqual(result.appliedFilters, { languageTags: ['FRENCH'], minResolution: '1080p' });
    assert.match(result.addons[0].streams[0].name, /Movie\.2026\.WEB-DL\.mkv/);

    const strictResult = evaluateAvailability(result.streamCount, result.addons, {
        minStreamCount: 1,
        minAddonCount: 2
    });
    assert.equal(strictResult.available, false);
});

test('AIOStreams account addon remains compatible with object-form stream resources', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    const manifestUrl = 'https://stremio-aiostreams.example/stremio/config/manifest.json';
    const streamUrl = 'https://stremio-aiostreams.example/stremio/config/stream/movie/tt0133093.json';

    global.fetch = async (url, options = {}) => {
        const value = String(url);
        if (value === 'https://api.strem.io/api/addonCollectionGet') {
            assert.equal(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    result: {
                        addons: [{
                            transportUrl: manifestUrl,
                            manifest: {
                                id: 'stremio-aiostreams.example.config',
                                name: 'AIOStreams',
                                version: '2.33.2',
                                resources: [{ name: 'stream', types: ['movie', 'series'] }],
                                types: ['movie', 'series']
                            }
                        }]
                    }
                })
            };
        }

        if (value === streamUrl) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    streams: [{
                        name: 'AIOStreams',
                        title: '1080p MULTI',
                        url: 'https://video.example/aiostreams.mp4',
                        behaviorHints: { filename: 'The.Matrix.1999.MULTI.1080p.mkv' }
                    }]
                })
            };
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await checkStreamsWithUserAddons(
        { title: 'The Matrix', type: 'movie', imdb_id: 'tt0133093' },
        'auth-key',
        null,
        { languageTags: ['MULTI'], minResolution: '1080p' },
        [],
        { minStreamCount: 1, minAddonCount: 1 }
    );

    assert.equal(result.available, true);
    assert.equal(result.streamCount, 1);
    assert.equal(result.addonsCount, 1);
    assert.equal(result.addons[0].name, 'AIOStreams');
});


test('stores up to 50 release names per addon while preserving full source count', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const manifestUrl = 'https://long-list.example/manifest.json';
    global.fetch = async (url) => String(url) === manifestUrl
        ? { ok: true, json: async () => ({ id:'many', name:'Many sources', resources:['stream'] }) }
        : { ok: true, json: async () => ({ streams: Array.from({ length: 60 }, (_, i) => ({
            title: `Film.1080p.MULTI.Release.${i}`, infoHash: `0123456789abcdef${i.toString(16).padStart(2, '0')}`
        })) }) };
    const result = await checkStreamsWithUserAddons({
        title: 'Film', type:'movie', imdb_id:'tt1234567'
    }, null, null, {languageTags:['MULTI'],minResolution:'1080p'}, [manifestUrl]);
    assert.equal(result.streamCount, 60);
    assert.equal(result.addons[0].streamCount, 60);
    assert.equal(result.addons[0].streams.length, 50);
    assert.match(result.addons[0].streams[49].name, /Release\.49/);
    assert.deepEqual(result.appliedFilters, {languageTags:['MULTI'], minResolution:'1080p'});
});
