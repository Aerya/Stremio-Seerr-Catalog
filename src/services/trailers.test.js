const test = require('node:test');
const assert = require('node:assert/strict');
const { requestedLanguages, createTrailerService } = require('./trailers');
const settings = new Map();
const db = { getSetting: key => key === 'tmdb_api_key' ? 'fixture-key' : settings.get(key) };
const media = { type: 'movie', tmdb_id: 42, user_id: 1 };
const video = (key, language = 'fr', extra = {}) => ({ key, iso_639_1: language, site: 'YouTube', type: 'Trailer', ...extra });

test('language follows primary release tags, never UI, MULTI or fallback tags', () => {
    assert.deepEqual(requestedLanguages(db, 1), ['fr']);
    settings.set('stream_filter_languages_1', '["ENGLISH","MULTI"]');
    assert.deepEqual(requestedLanguages(db, 1), ['en']);
    settings.set('stream_filter_languages_1', '["de-DE","GERMAN"]');
    assert.deepEqual(requestedLanguages(db, 1), ['de']);
    settings.set('stream_filter_languages_1', '["MULTI","custom-regex"]');
    settings.set('stream_fallback_languages_1', '["VOSTFR"]');
    assert.deepEqual(requestedLanguages(db, 1), []);
    assert.deepEqual(requestedLanguages(db, null), []);
    settings.set('stream_filter_languages_1', '{bad');
    assert.deepEqual(requestedLanguages(db, 1), []);
    settings.clear();
});

test('filters language/type/provider, prioritizes official trailers, deduplicates and caches concurrent requests', async () => {
    let calls = 0;
    const get = createTrailerService({ fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url.pathname, '/3/movie/42/videos');
        assert.equal(url.searchParams.get('language'), 'fr');
        assert.ok(options.signal);
        return { ok: true, json: async () => ({ results: [
            video('aaaaaaaaaaa'), video('bbbbbbbbbbb', 'fr', { official: true }),
            video('bbbbbbbbbbb'), video('ccccccccccc', 'en'),
            video('ddddddddddd', 'fr', { type: 'Teaser' }),
            video('eeeeeeeeeee', 'fr', { site: 'Vimeo' }), video('../invalid'), null
        ] }) };
    } });
    const [a, b] = await Promise.all([get(media, db), get(media, db)]);
    assert.deepEqual(a, [{ source: 'bbbbbbbbbbb', type: 'Trailer' }, { source: 'aaaaaaaaaaa', type: 'Trailer' }]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    await get(media, db);
    assert.equal(calls, 1);
});

test('series and multiple languages use separate cache entries; preference changes apply immediately', async () => {
    const calls = [];
    const get = createTrailerService({ fetchImpl: async url => {
        calls.push(url.pathname + '?' + url.searchParams.get('language'));
        const language = url.searchParams.get('language');
        return { ok: true, json: async () => ({ results: [video(language === 'en' ? 'eeeeeeeeeee' : 'fffffffffff', language)] }) };
    } });
    settings.set('stream_filter_languages_2', '["FRENCH","ENGLISH"]');
    assert.equal((await get({ ...media, type: 'series' }, db, 2)).length, 2);
    settings.set('stream_filter_languages_2', '["ENGLISH","MULTI"]');
    assert.deepEqual(await get({ ...media, type: 'series' }, db, 2), [{ source: 'eeeeeeeeeee', type: 'Trailer' }]);
    assert.deepEqual(calls.sort(), ['/3/tv/42/videos?en', '/3/tv/42/videos?fr']);
    settings.clear();
});

test('no matching language, missing key, invalid media and TMDB failures never invent a trailer', async () => {
    let calls = 0, time = 0;
    const get = createTrailerService({ now: () => time, fetchImpl: async () => { calls++; throw new Error('network timeout'); } });
    assert.deepEqual(await get(media, db), []);
    assert.deepEqual(await get(media, db), []);
    assert.equal(calls, 1);
    time = 300001;
    await get(media, db);
    assert.equal(calls, 2);
    await get({ ...media, tmdb_id: 'bad' }, db);
    await get(media, { getSetting: () => null });
    settings.set('stream_filter_languages_1', '["MULTI"]');
    await get(media, db);
    assert.equal(calls, 2);
    settings.clear();
    const empty = createTrailerService({ fetchImpl: async () => ({ ok: true, json: async () => ({ results: [video('aaaaaaaaaaa', 'en')] }) }) });
    assert.deepEqual(await empty(media, db), []);
});
