const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('./supplementalSearch');
const { checkStreamsWithUserAddons } = require('./stremio');
const media = {id:1,type:'movie',imdb_id:'tt0133093',tmdb_id:603,title:'The Matrix',year:1999};
function database() { const data = new Map(); return {getSetting:k=>data.get(k),setSetting:(k,v)=>data.set(k,v)}; }
const response = data => ({ok:true,text:async()=>JSON.stringify(data)});

test('Prowlarr direct search scopes titles, keeps reusable hashes, shares cached results and never returns the API key', async t => {
 const db=database(); service.updateSettings(db,{mode:'prowlarr',prowlarrUrl:'https://prowlarr.test',prowlarrKey:'private'});
 assert.equal(JSON.stringify(service.getSettings(db)).includes('private'),false);
 const old=global.fetch; t.after(()=>{global.fetch=old});let count=0;
 global.fetch=async (url,opts)=>{count++;assert.equal(opts.headers['X-Api-Key'],'private');assert.equal(opts.redirect,'error');assert.equal(new URL(url).searchParams.get('categories'),'2000');return response([
  {title:'The.Matrix.1999.ENGLISH.1080p',infoHash:'a'.repeat(40),indexerId:1},
  {title:'The.Matrix.1999.ENGLISH.1080p',infoHash:'b'.repeat(40),indexerId:2},
  {title:'The.Matrix.2021.ENGLISH.1080p',infoHash:'c'.repeat(40)},
  {title:'Other.1999.ENGLISH.1080p',infoHash:'d'.repeat(40)},
  {title:'The.Matrix.1999.ENGLISH.1080p',downloadUrl:'https://prowlarr.test/file.nzb'}
 ])};
 const [a,b]=await Promise.all([service.search(db,media,[media.imdb_id]),service.search(db,media,[media.imdb_id])]);
 assert.equal(count,1); assert.equal(a[0].streams.length,2);assert.deepEqual(a,b);
 await service.search(db,media,[media.imdb_id]);assert.equal(count,1);
 assert.equal(service.matches({title:'Show.S02E03.ENGLISH'}, {type:'series',title:'Show'},2,1),false);
 assert.equal(service.matches({title:'Show.S02.ENGLISH'}, {type:'series',title:'Show'},2,1),true);
});

test('Remix connection and search authenticate with shared token; incomplete searches are not cached', async t => {
 const db=database();db.setSetting('ether_remix_enabled','true');db.setSetting('ether_remix_token','shared');
 service.updateSettings(db,{mode:'remix',remixUrl:'https://remix.test'});
 const old=global.fetch;t.after(()=>{global.fetch=old});let count=0;
 global.fetch=async(url,opts)=>{count++;assert.equal(opts.headers.Authorization,'Bearer shared');return response(opts.method==='POST'?{schema:'seerrcatalog.search.v1',streams:[],conclusive:false}:{schema:'seerrcatalog.search.v1',ready:true})};
 await service.testConnection(db);
 await assert.rejects(service.search(db,media,[media.imdb_id]),/Incomplete/);
 await assert.rejects(service.search(db,media,[media.imdb_id]),/Incomplete/);assert.equal(count,3);
 db.setSetting('ether_remix_enabled','false');await assert.rejects(service.search(db,media,[media.imdb_id]),/disabled/);
});

test('supplemental provider obeys primary priority, deduplicates hashes and preserves incomplete failure', async t => {
 const old=global.fetch;t.after(()=>{global.fetch=old});
 let streams=[{title:'The.Matrix.ENGLISH.1080p',infoHash:'a'.repeat(40)}];
 global.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('manifest.json')?{id:'main',name:'Main',resources:['stream']}:{streams}});
 let calls=0;
 const provider=async()=>{calls++;return [{addon:{id:'remix',name:'Remix'},streamId:media.imdb_id,streams:[{title:'The.Matrix.ENGLISH.1080p',infoHash:'a'.repeat(40)},{title:'The.Matrix.ENGLISH.1080p',infoHash:'b'.repeat(40)}]}]};
 const check=fn=>checkStreamsWithUserAddons(media,null,null,{languageTags:['GERMAN'],subtitleFallback:true,fallbackLanguageTags:['ENGLISH']},['https://supp-test.test/manifest.json'],null,true,fn);
 let r=await check(provider);assert.equal(r.available,true);assert.equal(r.streamCount,2);assert.equal(calls,1);assert.deepEqual(r.appliedFilters.languageTags,['ENGLISH']);
 streams.push({title:'The.Matrix.GERMAN.1080p',infoHash:'c'.repeat(40)});
 r=await check(provider);assert.equal(r.streamCount,1);assert.equal(calls,1);assert.equal(r.appliedFilters.subtitleFallbackUsed,false);
 streams=[];r=await check(async()=>{throw new Error('provider unavailable')});assert.equal(r.conclusive,false);
 r=await checkStreamsWithUserAddons(media,null,null,{languageTags:['ENGLISH']},[],null,true,provider);
 assert.equal(r.available,true);assert.equal(r.streamCount,2);
});


test('series fallback counts one episode only and can find the preferred language in another monitored season', async t => {
 const db=database(); service.updateSettings(db,{mode:'prowlarr',prowlarrUrl:'https://series.test',prowlarrKey:'key'});
 const old=global.fetch;t.after(()=>{global.fetch=old});
 global.fetch=async url=>{const query=new URL(url).searchParams.get('query');return response([{title:query+'.'+(query.includes('S02')?'ENGLISH':'GERMAN')+'.1080p',infoHash:(query.includes('S02')?'a':'b').repeat(40)}])};
 const m={...media,type:'series',title:'Show'};
 const groups=await service.search(db,m,[media.imdb_id+':2:1',media.imdb_id+':1:1'],{languageTags:['GERMAN'],subtitleFallback:true,fallbackLanguageTags:['ENGLISH']});
 assert.equal(groups.length,1);assert.equal(groups[0].streamId,media.imdb_id+':1:1');assert.equal(groups[0].streams.length,1);
});
