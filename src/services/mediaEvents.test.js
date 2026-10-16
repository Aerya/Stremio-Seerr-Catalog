const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { recordStreamCheck, notifyRemoval, deleteMediaWithNotification } = require('./mediaEvents');

function fakeDatabase() {
    const stored = new Map([[4, {
        id: 4, title: 'Dead Mine', type: 'movie', year: 2012,
        user_id: 1, streams_available: 0
    }]]);
    return {
        stored,
        getMediaById: id => stored.get(id),
        updateStreamStatus: (id, available) => {
            stored.set(id, { ...stored.get(id), streams_available: available ? 1 : 0 });
        },
        deleteMedia: id => {
            const changes = stored.delete(id) ? 1 : 0;
            return { changes };
        }
    };
}
const success = { conclusive: true, available: true, streamCount: 3, addons: [], lastChecked: '2026-10-16T10:00:00Z' };
const noSources = { conclusive: true, available: false, streamCount: 0, addons: [], lastChecked: '2026-10-16T10:00:00Z' };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('manual and periodic checks emit only the first unavailable -> available transition', async () => {
    const db = fakeDatabase();
    const calls = [];
    const notifier = (media, result) => calls.push([media.id, result.streamCount]);
    const first = await recordStreamCheck(db, db.getMediaById(4), success, notifier);
    const next = await recordStreamCheck(db, db.getMediaById(4), success, notifier);
    assert.deepEqual(first, { updated: true, newlyAvailable: true });
    assert.deepEqual(next, { updated: true, newlyAvailable: false });
    await flush();
    assert.deepEqual(calls, [[4, 3]]);
});

test('incomplete checks keep old status and do not notify', async () => {
    const db = fakeDatabase();
    const calls = [];
    const result = await recordStreamCheck(db, db.getMediaById(4), { ...success, conclusive: false }, () => calls.push('called'));
    assert.equal(result.updated, false);
    assert.equal(db.getMediaById(4).streams_available, 0);
    assert.deepEqual(calls, []);
});

test('negative result is silent, later positive is announced, and no duplicate follows', async () => {
    const db = fakeDatabase();
    const calls = [];
    await recordStreamCheck(db, db.getMediaById(4), noSources, () => calls.push('found'));
    await recordStreamCheck(db, db.getMediaById(4), success, () => calls.push('found'));
    await recordStreamCheck(db, db.getMediaById(4), success, () => calls.push('found'));
    await flush();
    assert.deepEqual(calls, ['found']);
});

test('deletion notifies once, after successful DB deletion', async () => {
    const db = fakeDatabase();
    const removed = [];
    const media = db.getMediaById(4);
    const first = db.deleteMedia(4);
    assert.equal(notifyRemoval(media, first, 'watched', (m,r) => {
        assert.equal(db.getMediaById(4), undefined);
        removed.push([m.title,r]);
    }), true);
    assert.equal(notifyRemoval(media, db.deleteMedia(4), 'watched', () => removed.push('again')), false);
    await flush();
    assert.deepEqual(removed, [['Dead Mine','watched']]);
});

test('deleteMediaWithNotification keeps deletion synchronous and calls notifier for external removal', async () => {
    const db = fakeDatabase();
    const media = db.getMediaById(4);
    const received = [];
    const result = deleteMediaWithNotification(db, media, 'external', (_, reason) => received.push(reason));
    assert.equal(result.changes, 1);
    assert.equal(db.getMediaById(4), undefined);
    await flush();
    assert.deepEqual(received, ['external']);
});

test('no event for watched mark without deletion, and failed notifications never undo state', async () => {
    const db = fakeDatabase();
    const media = db.getMediaById(4);
    assert.equal(notifyRemoval(media, { changes: 0 }, 'watched', () => { throw Error('must not call'); }), false);
    await recordStreamCheck(db, media, success, () => { throw Error('fake network error'); });
    await flush();
    assert.equal(db.getMediaById(4).streams_available, 1);
});

function discordSandbox(settings = {}) {
    const messages = [];
    const stub = {
        getSetting: key => settings[key] ?? null,
        setSetting: (key,value) => { settings[key] = value; }
    };
    const src = fs.readFileSync(path.join(__dirname, 'discord.js'), 'utf8');
    const sandbox = {
        module: { exports: {} },
        require: spec => {
            assert.equal(spec, '../db');
            return stub;
        },
        fetch: async (_,opts) => {
            messages.push(JSON.parse(opts.body));
            return { ok:true };
        },
        console: { log() {}, error() {} },
        Date,
    };
    vm.runInNewContext(src, sandbox, { filename: 'discord.js' });
    sandbox.module.exports.addWebhookUrl('https://discord.com/api/webhooks/123456/abc');
    return { api: sandbox.module.exports, messages };
}

test('source-found embed includes type, title, source count and suppresses Discord mentions', async () => {
    const { api, messages } = discordSandbox({ discord_notifications_language: 'fr' });
    await api.sendSourcesFoundNotification({ id: 4, title: 'Dead Mine', type: 'movie', year: 2012 }, {
        streamCount: 2, addons: [{ name: 'AIOStreams', streams: [{name:'release'}] }]
    });
    assert.equal(messages.length, 1);
    const embed = messages[0].embeds[0];
    assert.match(embed.title, /Sources trouvées/);
    assert.match(embed.fields[0].value, /Dead Mine/);
    assert.equal(embed.fields[1].value, '2');
    assert.match(embed.fields[2].value, /AIOStreams/);
    assert.equal(messages[0].allowed_mentions.parse.length, 0);
});

test('removed embed differentiates watched, manual and external requests in FR and EN', async () => {
    const { api, messages } = discordSandbox({ discord_notifications_language: 'fr' });
    const media = { id: 4, title:'Dead Mine', type:'movie' };
    for (const why of ['watched','manual','external']) {
        await api.sendMediaRemovedNotification(media, why);
    }
    assert.equal(messages.length, 3);
    assert.match(messages[0].embeds[0].fields[1].value, /Visionné/);
    assert.match(messages[1].embeds[0].fields[1].value, /Suppression manuelle/);
    assert.match(messages[2].embeds[0].fields[1].value, /Radarr\/Sonarr/);
    api.setNotificationLanguage('en');
    await api.sendMediaRemovedNotification(media, 'watched');
    assert.match(messages[3].embeds[0].fields[1].value, /Watched/);
});

test('global notifications disabled also suppresses the new events', async () => {
    const { api, messages } = discordSandbox({ discord_notifications_enabled:'false' });
    await api.sendSourcesFoundNotification({ title:'Film', type:'movie' }, success);
    await api.sendMediaRemovedNotification({ title:'Film', type:'movie' }, 'manual');
    assert.equal(messages.length, 0);
});
