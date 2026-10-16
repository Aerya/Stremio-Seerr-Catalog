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
    assert.equal(embed.fields.find(f => f.name === 'Sources').value, '2');
    assert.match(embed.fields.find(f => f.name === 'Addons').value, /AIOStreams/);
    assert.match(embed.fields.find(f => f.name === 'Filtres de recherche').value, /Aucun/);
    assert.match(embed.fields.find(f => f.name.includes('Releases disponibles')).value, /release/);
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


test('source-found notification preserves IMDB/TMDB URLs and displays applied filters and releases (FR)', async () => {
    const { api, messages } = discordSandbox({
        discord_notifications_language: 'fr',
        stream_filter_languages_7: '["GERMAN"]',
        stream_filter_resolution_7: '720p'
    });
    const media = { id: 23, user_id: 7, type: 'movie', title: 'Dead Mine', year: 2012,
        imdb_id: 'tt2171847', tmdb_id: 190899 };
    const result = {
        streamCount: 2,
        appliedFilters: { languageTags: ['FRENCH', 'MULTI'], minResolution: '1080p' },
        addons: [{ name: 'AIOStreams', streamCount: 2, streams: [
            { name: 'Dead.Mine.2012.MULTi.VFF.1080p.BluRay.HDLight.x264-PTN.mkv', quality: '1080p', size: '2.46 GB' },
            { name: 'Dead.Mine.2012.FRENCH.2160p.WEB-DL.mkv', quality: '2160p', size: '8 GB' }
        ] }]
    };
    await api.sendSourcesFoundNotification(media, result);
    const embed = messages[0].embeds[0];
    // Do not change the existing sources-found links in any way.
    assert.equal(embed.description,
        'https://www.imdb.com/title/tt2171847\nhttps://www.themoviedb.org/movie/190899'.replace('\\n', '\n'));
    const filters = embed.fields.find(f => f.name === 'Filtres de recherche').value;
    assert.match(filters, /FRENCH, MULTI/);
    assert.match(filters, /1080p/);
    assert.doesNotMatch(filters, /GERMAN|720p/); // The snapshot takes precedence over later settings.
    const releases = embed.fields.filter(f => f.name.startsWith('Releases disponibles'));
    assert.equal(releases.length, 1);
    assert.match(releases[0].name, /AIOStreams/);
    assert.match(releases[0].value, /2\.46 GB/);
    assert.match(releases[0].value, /Dead\.Mine\.2012\.MULTi\.VFF\.1080p/);
    assert.match(releases[0].value, /2160p/);
    assert.equal(messages.length, 1);
});

test('legacy source-found result uses saved owner filters; English is translated', async () => {
    const { api, messages } = discordSandbox({
        discord_notifications_language: 'en',
        stream_filter_languages_7: '["FRENCH","MULTI"]',
        stream_filter_resolution_7: '1080p'
    });
    await api.sendSourcesFoundNotification({ user_id: 7, type: 'series', title: 'Season Test', tmdb_id: 3345 }, {
        streamCount: 1,
        addons: [{ name: 'Cinema', streamCount: 1, streams: [{name:'Season.Test.S03E01.1080p'}] }]
    });
    const embed = messages[0].embeds[0];
    assert.match(embed.fields.find(f => f.name === 'Search Filters').value, /FRENCH, MULTI/);
    assert.match(embed.fields.find(f => f.name === 'Search Filters').value, /1080p/);
    assert.match(embed.fields.find(f => f.name.startsWith('Available releases')).value, /S03E01/);
    assert.match(embed.description, /https:\/\/www.themoviedb.org\/tv\/3345/);
});

test('long lists are split under Discord limits and report omitted releases, without markdown pings', async () => {
    const { api, messages } = discordSandbox({ discord_notifications_language: 'fr' });
    const huge = Array.from({ length: 90 }, (_,i) => ({
        name: `Title.Release.${i}.1080p.FRENCH.${'x'.repeat(210)}@everyone`, quality:'1080p', size:'2.44 GB'
    }));
    await api.sendSourcesFoundNotification({ type:'movie', title:'Very long title'.repeat(15), imdb_id:'tt2171847' }, {
        streamCount: 215, appliedFilters: { languageTags: ['FRENCH'], minResolution: '1080p' },
        addons: [
            { name: 'AIOStreams', streamCount: 100, streams: huge },
            { name: 'Second addon', streamCount: 115, streams: huge }
        ]
    });
    assert.equal(messages.length, 1);
    const [embed] = messages[0].embeds;
    assert.ok(embed.fields.length <= 25);
    assert.ok(embed.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
    const total = embed.title.length + embed.description.length + embed.author.name.length +
        embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000, `embed ${total} chars`);
    assert.ok(embed.fields.some(f => f.name === 'Autres releases non affichées'));
    assert.equal(messages[0].allowed_mentions.parse.length, 0);
    assert.doesNotMatch(JSON.stringify(embed), /@everyone/);
});

test('no-source notification keeps filters and IMDB/TMDB links unchanged', async () => {
    const { api, messages } = discordSandbox({ discord_notifications_language: 'fr' });
    await api.sendNoSourceNotification({ type:'movie', title:'Dead Mine', year:2012,
        imdb_id:'tt2171847', tmdb_id:190899 }, { languageTags:['FRENCH','MULTI'], minResolution:'1080p' });
    const embed = messages[0].embeds[0];
    assert.match(embed.description, /\*\*IMDB ID:\*\* `tt2171847`/);
    assert.match(embed.description, /https:\/\/www.imdb.com\/title\/tt2171847/);
    assert.match(embed.description, /https:\/\/www.themoviedb.org\/movie\/190899/);
    assert.match(embed.fields.find(f => f.name === 'Filtres de recherche').value, /FRENCH, MULTI/);
    assert.match(embed.fields.find(f => f.name === 'Filtres de recherche').value, /1080p/);
});
