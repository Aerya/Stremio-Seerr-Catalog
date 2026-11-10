const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-catalog-test-'));
process.env.DATA_DIR = dir;
const db = require('../db');
const { catalogHandler } = require('./handlers');
const express = require('express');
const users = require('../api/users');

test('personal availability preference filters catalogue/search before pagination and persists via API', async (t) => {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const alice = db.createUser('alice', 'test-password');
    const bob = db.createUser('bob', 'test-password');
    let n = 1;
    const add = (user, type, available) => {
        const media = db.addMedia({ user_id: user.id, type, title: `Test ${n}`, tmdb_id: n, imdb_id: `tt${n++}` });
        if (available !== null) db.updateStreamStatus(media.id, available, available ? 1 : 0, new Date().toISOString());
        return media;
    };
    const movie = add(alice, 'movie', true);
    const series = add(alice, 'series', true);
    add(alice, 'series', false);
    add(alice, 'movie', null); // Never checked.
    for (let i = 0; i < 105; i++) add(alice, 'movie', false);
    add(bob, 'movie', false);
    const app = express();
    app.use(express.json());
    app.use('/users', users);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const url = `http://127.0.0.1:${server.address().port}/users/${alice.id}/stream-filters`;
    const put = (value) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const catalog = (type, extra = {}, userId = alice.id) => catalogHandler({ type, id: `seerr-${type === 'movie' ? 'movies' : 'series'}`, userId, extra });
    assert.equal((await (await fetch(url)).json()).catalogAvailableOnly, false);
    assert.equal((await catalog('movie')).metas.length, 100);
    assert.equal((await put({ catalogAvailableOnly: 'false' })).status, 400);
    assert.equal((await put({ catalogAvailableOnly: true })).status, 200);
    assert.equal((await (await fetch(url)).json()).catalogAvailableOnly, true);
    assert.deepEqual((await catalog('movie')).metas.map(m => m.id), [movie.imdb_id]);
    assert.deepEqual((await catalog('series')).metas.map(m => m.id), [series.imdb_id]);
    assert.deepEqual((await catalog('movie', { search: 'Test', skip: '0' })).metas.map(m => m.id), [movie.imdb_id]);
    assert.equal((await catalog('movie', { skip: '1' })).metas.length, 0);
    assert.equal((await catalog('movie', {}, bob.id)).metas.length, 1);
    assert.equal((await catalogHandler({ type: 'movie', id: 'seerr-movies' })).metas.length, 100);
    await put({ minStreamCount: 2 }); // Older API clients must not reset the preference.
    assert.equal((await (await fetch(url)).json()).catalogAvailableOnly, true);
    db.updateStreamStatus(movie.id, false, 0, new Date().toISOString());
    assert.equal((await catalog('movie')).metas.length, 0);
    await put({ catalogAvailableOnly: false });
    assert.equal((await catalog('movie')).metas.length, 100);
    assert.equal(db.getFilteredMedia({ userId: alice.id, type: 'movie' }).length, 107);
});
