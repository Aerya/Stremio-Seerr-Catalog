const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-remix-'));
process.env.DATA_DIR = directory;
const db = require('../db');
const remix = require('./remixIntegration');
const { createRouter } = require('../api/remix');

test('real SQLite feed catches updates/deletions, detects changed pages and revokes access', async t => {
    t.after(() => { db.db.close(); fs.rmSync(directory, {recursive: true, force: true}); });
    // Minimal media records obey the same schema as a Seerr request.
    db.db.prepare("INSERT INTO media (id, type, tmdb_id, title) VALUES (1,'movie',603,'Matrix'), (2,'movie',604,'Other')").run();
    const token = remix.generateToken(db);
    remix.updateSettings(db, {enabled: true});
    const snapshot = id => remix.snapshot(db.getMediaById(id), {conclusive: true, available: true, lastChecked: new Date().toISOString()});
    db.saveRemixSnapshot(1, snapshot(1)); db.saveRemixSnapshot(2, snapshot(2));
    const app = express(); app.use(createRouter(db));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/v1/availability`;
    const get = query => fetch(base + query, {headers:{Authorization:`Bearer ${token}`}});
    const first = await (await get('?limit=1')).json();
    assert.equal(first.items.length, 1); assert.equal(first.nextCursor, 1);
    db.saveRemixSnapshot(1, {...snapshot(1), available:false, checkStatus:'unavailable'});
    assert.equal((await get(`?after=1&revision=${first.revision}`)).status,409);
    const current = await (await get('')).json(); assert.equal(current.items[0].available,false);
    // Even deletion outside the notification helper is observed on a full read.
    db.db.prepare('DELETE FROM media WHERE id=2').run();
    const afterDelete = await (await get('')).json(); assert.equal(afterDelete.items.length,1);
    assert.ok(afterDelete.revision > current.revision);
    remix.generateToken(db); assert.equal((await get('')).status,401);
    remix.updateSettings(db,{enabled:false}); assert.equal(db.getRemixSnapshotsAfter().length,0);
});
