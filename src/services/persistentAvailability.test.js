const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-workflow-'));
process.env.DATA_DIR = dir;
const db = require('../db');
const { recordStreamCheck } = require('./mediaEvents');
const { checkStreamsAvailable } = require('./streamChecker');
const { checkStreamsWithUserAddons } = require('./stremio');
const remix = require('./remixIntegration');
const notifications = require('./notifications');
const user = db.createUser('workflow', 'test-password', 'Workflow', true);
let nextID = 9000;
const add = () => db.addMedia({ user_id:user.id, type:'movie', tmdb_id:nextID++, imdb_id:'tt0133093', title:'Test title' });
const flush = () => new Promise(resolve => setImmediate(resolve));
const day = 86400000;
const result = (count, time) => ({ available:count>=2, conclusive:true, streamCount:count, addons:[], lastChecked:new Date(time).toISOString() });
test.after(() => { db.db.close(); fs.rmSync(dir, { recursive:true, force:true }); });

test('one release follows J+1 then J+3, persists timetable and alerts once with a restricted mention', async t => {
    const media = add(), start = Date.now();
    const original = global.fetch, sent = [];
    t.after(() => { global.fetch = original; db.setSetting('discord_webhooks','[]'); });
    db.setSetting('discord_webhooks', JSON.stringify(['https://discord.com/api/webhooks/test/example']));
    db.setSetting('review_mention', '123456789012345678');
    global.fetch = async (url, options) => { sent.push(JSON.parse(options.body)); return { ok:true }; };
    await recordStreamCheck(db, media, result(1,start));
    assert.equal(Date.parse(db.getMediaById(media.id).next_search_at), start+day);
    await recordStreamCheck(db, media, result(1,start+day));
    assert.equal(Date.parse(db.getMediaById(media.id).next_search_at), start+3*day);
    assert.equal(db.getMediaById(media.id).search_stage,1);
    await flush(); assert.equal(sent.length,0);
    await recordStreamCheck(db, media, result(1,start+3*day));
    await flush(); assert.equal(sent.length,1);
    assert.deepEqual(sent[0].allowed_mentions, { parse:[], users:['123456789012345678'] });
    assert.match(sent[0].content, /<@123456789012345678>/);
    assert.equal(db.getMediaById(media.id).streams_available,0);
    await recordStreamCheck(db, media, result(1,start+4*day));
    await flush(); assert.equal(sent.length,1);
    // Reopening the SQLite file preserves deadlines and delivery state.
    const reopened = new (require('better-sqlite3'))(path.join(dir,'seerr-catalog.db'));
    const stored = reopened.prepare('SELECT * FROM media WHERE id=?').get(media.id); reopened.close();
    assert.equal(stored.search_stage,2); assert.equal(stored.review_notified,1);
    assert.equal(Date.parse(stored.next_search_at),start+5*day);
});

test('zero releases remain pending daily, without alert; positive status cannot regress or trigger a fetch', async t => {
    const media = add(), start = Date.now();
    const original=global.fetch; t.after(()=>{global.fetch=original;});
    global.fetch=async()=>{throw Error('Confirmed media must not query addons');};
    for (const offset of [0,1,2,3,10]) {
        await recordStreamCheck(db,media,result(0,start+offset*day));
        assert.equal(Date.parse(db.getMediaById(media.id).next_search_at),start+(offset+1)*day);
        assert.equal(db.getMediaById(media.id).review_notified,0);
    }
    await recordStreamCheck(db,media,result(2,start+11*day),()=>{});
    await recordStreamCheck(db,media,result(0,start+12*day));
    db.updateStreamStatus(media.id,false,0,new Date().toISOString());
    assert.equal(db.getMediaById(media.id).streams_available,1);
    assert.equal(db.getMediaById(media.id).next_search_at,null);
    assert.equal((await checkStreamsAvailable(media,db)).frozen,true);
    const repeated = db.addMedia({user_id:user.id,type:media.type,tmdb_id:media.tmdb_id,title:media.title});
    assert.equal(repeated.id,media.id); assert.equal(repeated.streams_available,1);
});

test('VOSTFR fallback reuses fetched streams, never overrides one FR release, and deduplicates identical releases', async t => {
    const original=global.fetch; t.after(()=>{global.fetch=original;});
    let requests=0;
    let streams=[{title:'Title.SUBFRENCH.1080p',url:'https://video.test/sub1'}, {title:'Title.VOSTFR.1080p',url:'https://video.test/sub2'}];
    global.fetch=async url=>String(url).endsWith('manifest.json')
        ? {ok:true,json:async()=>({id:'fallback',name:'Fallback',resources:['stream']})}
        : (requests++,{ok:true,json:async()=>({streams})});
    const check=()=>checkStreamsWithUserAddons({type:'movie',imdb_id:'tt0133093'},null,null,
        {languageTags:['FRENCH','MULTI'],subtitleFallback:true},['https://fallback.test/manifest.json']);
    let r=await check(); assert.equal(r.available,true); assert.equal(r.appliedFilters.subtitleFallbackUsed,true); assert.equal(requests,1);
    streams.push({title:'Title.FRENCH.1080p',url:'https://video.test/fr'});
    r=await check(); assert.equal(r.streamCount,1); assert.equal(r.available,false); assert.equal(r.appliedFilters.subtitleFallbackUsed,false); assert.equal(requests,2);
    streams.push(streams[2]); r=await check(); assert.equal(r.streamCount,1); assert.equal(r.available,false);
});

test('manual approval rejects zero sources and freezes a single release; old available media backfills Remix without fresh links', async t => {
    const express=require('express'), app=express(); app.use(express.json()); app.use(require('../webui/routes'));
    const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>{server.closeAllConnections();server.close();});
    const base=`http://127.0.0.1:${server.address().port}`;
    const media=add();
    assert.equal((await fetch(`${base}/api/media/${media.id}/approve`,{method:'POST'})).status,409);
    await recordStreamCheck(db,media,result(1,Date.now()-40*day));
    assert.equal((await fetch(`${base}/api/media/${media.id}/approve`,{method:'POST'})).status,200);
    assert.equal(db.getMediaById(media.id).availability_manual,1);
    remix.generateToken(db); remix.updateSettings(db,{enabled:true});
    remix.ensureConfirmedSnapshots(db);
    const value=db.getRemixSnapshotsAfter(0,100).find(x=>x.id===media.id).payload;
    assert.equal(value.availabilityConfirmed,true);
    assert.equal(remix.activeSnapshot(value).available,true);
    assert.deepEqual(remix.activeSnapshot(value).releases,[]);
    assert.ok(Date.parse(value.releasesExpireAt)<Date.now());
    db.deleteMedia(media.id);
    assert.equal(db.getRemixSnapshotsAfter(0,100).some(x=>x.id===media.id),false);
});

test('Apprise supports stateful endpoints and secret targets without exposing destinations', async t => {
    const original=global.fetch; t.after(()=>{global.fetch=original;});
    let payload;
    global.fetch=async(url,options)=>{assert.equal(url,'https://apprise.test/notify/key');payload=JSON.parse(options.body);return {ok:true};};
    notifications.save({enabled:true,endpoint:'https://apprise.test/notify/key',urls:'discord://private-token'});
    assert.equal(notifications.settings().urls,undefined);
    assert.equal(await notifications.sendApprise('Test','Body'),true);
    assert.equal(payload.urls,'discord://private-token');
    notifications.save({urls:''}); await notifications.sendApprise('Test','Body'); assert.equal('urls' in payload,false);
    assert.throws(()=>notifications.save({mention:'@everyone'}));
    global.fetch=async()=>({ok:false,status:503});
    await assert.rejects(notifications.sendApprise('Test','Body'),/503/);
    notifications.save({enabled:false});
});


test('missed J+1 and overlapping results cannot consume J+3 in the same check', async () => {
    const media=add(), start=Date.now();
    await recordStreamCheck(db,media,result(1,start));
    const late=result(1,start+4*day);
    await recordStreamCheck(db,media,late);
    await recordStreamCheck(db,media,late);
    await recordStreamCheck(db,media,result(1,start+4*day+1));
    assert.equal(db.getMediaById(media.id).search_stage,1);
    assert.equal(db.getMediaById(media.id).review_notified,0);
});
