const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-trailer-meta-'));
process.env.DATA_DIR = dir;
delete process.env.TMDB_API_KEY;
const db = require('../db');
const { catalogHandler, metaHandler } = require('./handlers');

test('existing personal/global movie and series metadata expose trailers without mixing users or affecting catalogues', async t => {
    const original = global.fetch;
    t.after(() => { global.fetch = original; db.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const fr = db.createUser('fr', 'test-password');
    const en = db.createUser('en', 'test-password');
    db.setSetting('tmdb_api_key', 'fixture');
    db.setSetting(`stream_filter_languages_${en.id}`, '["ENGLISH","MULTI"]');
    for (const user of [fr, en]) for (const type of ['movie', 'series']) {
        db.addMedia({ user_id: user.id, type, tmdb_id: 992, imdb_id: type === 'movie' ? 'tt00992' : null, title: 'Fixture' });
    }
    let calls = 0;
    global.fetch = async url => {
        calls++;
        const language = url.searchParams.get('language');
        return { ok: true, json: async () => ({ results: [{ site: 'YouTube', type: 'Trailer', iso_639_1: language, key: language === 'fr' ? 'fffffffffff' : 'eeeeeeeeeee' }] }) };
    };
    await catalogHandler({ type: 'movie', id: 'seerr-movies', userId: fr.id });
    assert.equal(calls, 0, 'catalogue browsing does not fan out TMDB calls');
    for (const [type, id] of [['movie', 'tt00992'], ['series', 'tmdb:992']]) {
        for (const [user, key] of [[fr, 'fffffffffff'], [en, 'eeeeeeeeeee']]) {
            const { meta } = await metaHandler({ type, id, userId: user.id });
            assert.equal(meta.name, 'Fixture');
            assert.deepEqual(meta.trailers, [{ source: key, type: 'Trailer' }]);
            assert.deepEqual(meta.trailerStreams, [{ ytId: key }]);
        }
        const globalMeta = await metaHandler({ type, id });
        assert.equal(globalMeta.meta.trailers[0].source, 'fffffffffff');
    }
    assert.equal(calls, 4, 'global request reuses owner language cache');
    assert.deepEqual(await metaHandler({ type: 'movie', id: 'tt00992', userId: 999 }), { meta: null });
    assert.deepEqual(await metaHandler({ type: 'series', id: 'tt00992', userId: fr.id }), { meta: null });
    db.setSetting(`stream_filter_languages_${en.id}`, '["MULTI"]');
    const { meta } = await metaHandler({ type: 'movie', id: 'tt00992', userId: en.id });
    assert.equal(meta.name, 'Fixture');
    assert.equal(meta.trailers, undefined);
    assert.equal(meta.trailerStreams, undefined);
});
