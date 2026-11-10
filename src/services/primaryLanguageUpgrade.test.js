const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-primary-'));
process.env.DATA_DIR = dir;
const db = require('../db');
const { recordStreamCheck, recordPrimaryLanguageUpgrade } = require('./mediaEvents');
const { checkPrimaryStreams, checkStreamsAvailable } = require('./streamChecker');
const user = db.createUser('primary', 'test', 'Primary', true);
let nextID = 91000;
const result = (count, subtitleFallbackUsed = false) => ({ available: count >= 2, conclusive: true, streamCount: count,
    lastChecked: new Date().toISOString(), addons: [{ id:'test',name:'Test',streamCount:count,streams:[] }],
    appliedFilters:{languageTags:subtitleFallbackUsed?['VOSTFR','SUBFRENCH']:['FRENCH','MULTI'],subtitleFallbackUsed,minResolution:'1080p'} });
async function fallback() {
    const media = db.addMedia({ user_id:user.id,type:'movie',tmdb_id:nextID++,imdb_id:'tt0133093',title:'Test' });
    await recordStreamCheck(db,media,result(2,true),()=>{});
    return db.getMediaById(media.id);
}
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});

test('failed, insufficient and fallback results preserve the entire confirmed row', async () => {
    const media = await fallback();
    for (const r of [result(0),result(1),{...result(2),conclusive:false},result(2,true)]) {
        assert.equal(recordPrimaryLanguageUpgrade(db,media,r),false);
        assert.deepEqual(db.getMediaById(media.id),media);
    }
});

test('successful upgrade replaces sources and shared snapshot, never availability or schedule', async () => {
    const media = await fallback();
    db.setSetting('ether_remix_enabled','true');
    const primary = {...result(3),lastChecked:new Date(Date.now()+1000).toISOString()};
    assert.equal(recordPrimaryLanguageUpgrade(db,media,primary),true);
    const updated=db.getMediaById(media.id);
    assert.equal(updated.streams_available,1);
    assert.equal(updated.stream_count,3);
    assert.equal(updated.last_stream_check,primary.lastChecked);
    assert.equal(updated.next_search_at,null);
    assert.deepEqual(updated.stream_filters_detail,primary.appliedFilters);
    assert.deepEqual(updated.streams_detail,primary.addons);
    const snapshot=JSON.parse(db.db.prepare('select payload from remix_snapshots where media_id=?').get(media.id).payload);
    assert.equal(snapshot.availabilityConfirmed,true);
    assert.equal(snapshot.appliedFilters.subtitleFallbackUsed,false);
    assert.equal(recordPrimaryLanguageUpgrade(db,media,primary),false);
    db.deleteMedia(media.id);
    assert.equal(recordPrimaryLanguageUpgrade(db,media,primary),false);
});

test('manual primary search queries addons and Remix, disables fallback and deduplicates simultaneous clicks', async t => {
    const media=await fallback();
    db.setSetting(`stremio_direct_manifests_${user.id}`,JSON.stringify(['https://primary.test/manifest.json']));
    db.setSetting(`stream_subtitle_fallback_${user.id}`,'true');
    db.setSetting(`stream_filter_resolution_${user.id}`,'1080p');
    db.setSetting('supplemental_mode','remix');
    db.setSetting('supplemental_remix_url','https://primary-remix.test');
    db.setSetting('supplemental_remix_token','x'.repeat(64));
    const old=global.fetch;t.after(()=>{global.fetch=old;});
    let remixCalls=0,addonCalls=0;
    global.fetch=async(url,options)=>{
        if(String(url).endsWith('manifest.json'))return {ok:true,json:async()=>({id:'primary',name:'Test',resources:['stream'],types:['movie']})};
        if(String(url).includes('/stream/')) {addonCalls++;return {ok:true,json:async()=>({streams:[{title:'Test.VOSTFR.1080p',infoHash:'c'.repeat(40)},{title:'Test.SUBFRENCH.1080p',infoHash:'d'.repeat(40)}]})};}
        remixCalls++;assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(64));
        return {ok:true,text:async()=>JSON.stringify({schema:'seerrcatalog.search.v1',conclusive:true,streams:[
            {title:'Test.FRENCH.1080p',infoHash:'a'.repeat(40)},
            {title:'Test.MULTI.1080p',infoHash:'b'.repeat(40)},
            {title:'Test.MULTI.1080p',infoHash:'b'.repeat(40)}]})};
    };
    assert.equal((await checkStreamsAvailable(media,db)).frozen,true);
    assert.equal(addonCalls,0);
    const first=checkPrimaryStreams(media,db), second=checkPrimaryStreams(media,db);
    assert.equal(first,second);
    const r=await first;
    assert.equal(r.available,true);assert.equal(r.streamCount,2);
    assert.equal(r.appliedFilters.subtitleFallbackUsed,false);
    assert.equal(addonCalls,1);assert.equal(remixCalls,1);
    assert.equal(db.getSetting(`stream_subtitle_fallback_${user.id}`),'true');
    assert.deepEqual(db.getMediaById(media.id),media); // Search alone cannot update availability.
    assert.equal(recordPrimaryLanguageUpgrade(db,media,r),true);
    await assert.rejects(checkPrimaryStreams(media,db),/Only confirmed fallback/);
});

test('deleted media and empty primary tags cannot launch an upgrade', async () => {
    const media=await fallback();
    db.setSetting(`stream_filter_languages_${user.id}`,'[]');
    await assert.rejects(checkPrimaryStreams(media,db),/Configure primary/);
    db.deleteMedia(media.id);
    await assert.rejects(checkPrimaryStreams(media,db),/Only confirmed fallback/);
});
