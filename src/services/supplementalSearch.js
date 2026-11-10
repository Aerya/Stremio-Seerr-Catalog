const crypto = require('node:crypto');
const PREFIX = 'supplemental_';
const cache = new Map();
const pending = new Map();
const HASH = /^[a-f0-9]{40}$/i;
const setting = (db, key) => db.getSetting(PREFIX + key);
function baseUrl(raw) {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Use an HTTP(S) base URL without credentials, query or fragment');
    return u.toString().replace(/\/$/, '');
}
function getSettings(db) {
    return { mode: setting(db, 'mode') || 'off', remixUrl: setting(db, 'remix_url') || '', prowlarrUrl: setting(db, 'prowlarr_url') || '', hasProwlarrKey: !!setting(db, 'prowlarr_key'), hasRemixToken: !!setting(db, 'remix_token') };
}
function updateSettings(db, body) {
    if (!['off', 'remix', 'prowlarr'].includes(body.mode)) throw new Error('Invalid search mode');
    const remixUrl = body.remixUrl ? baseUrl(body.remixUrl) : '';
    const prowlarrUrl = body.prowlarrUrl ? baseUrl(body.prowlarrUrl) : '';
    if (body.prowlarrKey !== undefined && (typeof body.prowlarrKey !== 'string' || body.prowlarrKey.length > 256 || /[\r\n]/.test(body.prowlarrKey))) throw new Error('Invalid API key');
    if (body.remixToken !== undefined && (typeof body.remixToken !== 'string' || (body.remixToken && (body.remixToken.length < 32 || body.remixToken.length > 256 || /\s/.test(body.remixToken))))) throw new Error('Search token must contain 32 to 256 characters without whitespace');
    if (body.mode === 'remix' && (!remixUrl || !(body.remixToken || setting(db, 'remix_token')))) throw new Error('Remix URL and dedicated search token required');
    if (body.mode === 'prowlarr' && (!prowlarrUrl || !(body.prowlarrKey || setting(db, 'prowlarr_key')))) throw new Error('Prowlarr URL and API key required');
    db.setSetting(PREFIX + 'mode', body.mode);
    db.setSetting(PREFIX + 'remix_url', remixUrl);
    db.setSetting(PREFIX + 'prowlarr_url', prowlarrUrl);
    if (body.remixToken) db.setSetting(PREFIX + 'remix_token', body.remixToken);
    if (body.prowlarrKey) db.setSetting(PREFIX + 'prowlarr_key', body.prowlarrKey);
    cache.clear();
    return getSettings(db);
}
async function request(url, options = {}) {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(80000) });
    if (!response.ok) throw new Error(`Supplemental search HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error('Search response too large');
    return JSON.parse(text);
}
async function testConnection(db) {
    const cfg = getSettings(db);
    if (cfg.mode === 'remix') {
        if (!setting(db, 'remix_token')) throw new Error('Configure the dedicated Remix search token');
        const result = await request(cfg.remixUrl + '/api/integrations/seerrcatalog/v1/search', {headers:{Authorization:'Bearer ' + setting(db, 'remix_token')}});
        if (result.schema !== 'seerrcatalog.search.v1' || !result.ready) throw new Error('Remix search unavailable: update Remix and enable SeerrCatalog searches');
    } else if (cfg.mode === 'prowlarr') {
        const result = await request(cfg.prowlarrUrl + '/api/v1/system/status', {headers:{'X-Api-Key':setting(db,'prowlarr_key')}});
        if (!result.version) throw new Error('Invalid Prowlarr response');
    } else throw new Error('Select and save a search provider first');
    return {success:true};
}
function infoHash(row) {
    if (typeof row.infoHash === 'string' && HASH.test(row.infoHash)) return row.infoHash.toLowerCase();
    for (const raw of [row.magnetUrl, row.downloadUrl, row.guid]) {
        if (typeof raw !== 'string' || !raw.startsWith('magnet:?')) continue;
        const xt = new URL(raw).searchParams.get('xt') || '';
        const hash = xt.replace(/^urn:btih:/i, '');
        if (HASH.test(hash)) return hash.toLowerCase();
    }
    return null;
}
const normalized = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function matches(row, media, season, episode) {
    const imdb = row.imdbId ? 'tt' + String(row.imdbId).replace(/^tt/, '') : '';
    if (imdb && imdb !== media.imdb_id) return false;
    if (row.tmdbId && Number(row.tmdbId) !== Number(media.tmdb_id)) return false;
    const name = normalized(row.title);
    const title = normalized(media.title);
    if (!imdb && !row.tmdbId && !(name === title || name.startsWith(title + ' '))) return false;
    if (media.type === 'series') {
        const match = /\bS(\d{1,3})(?:E(\d{1,4}))?/i.exec(String(row.title).replace(/[._]/g,' '));
        return !!match && Number(match[1]) === season && (!match[2] || Number(match[2]) === episode);
    }
    const years = String(row.title).match(/\b(?:19|20)\d{2}\b/g) || [];
    return !media.year || years.includes(String(media.year)) || ((imdb || row.tmdbId) && !years.length);
}
async function search(db, media, streamIds, filters = {}) {
    const cfg = getSettings(db);
    const token = cfg.mode === 'remix' ? setting(db, 'remix_token') : setting(db,'prowlarr_key');
    if (cfg.mode === 'off') return [];
    if (cfg.mode === 'remix' && !token) throw new Error('Configure the dedicated Remix search token');
    const key = crypto.createHash('sha256').update(JSON.stringify([cfg,token,media.type,media.imdb_id,media.tmdb_id,media.title,media.year,streamIds,filters])).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw new Error('Supplemental search busy; retry on next check');
    const work = (async () => {
        const groups = [];
        let complete = true;
        const {filterStreamsByLanguage, filterStreamsByResolution} = require('./stremio');
        const matching = (streams, tags) => {
            let found = tags?.length ? filterStreamsByLanguage(streams, tags) : streams;
            if (filters.minResolution) found = filterStreamsByResolution(found, filters.minResolution);
            return found.length > 0;
        };
        for (const streamId of streamIds) {
            const [,sn,en] = streamId.split(':');
            const season = Number(sn || 0), episode = Number(en || 0);
            let streams;
            if (cfg.mode === 'remix') {
                const data = await request(cfg.remixUrl + '/api/integrations/seerrcatalog/v1/search', {
                    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},
                    body:JSON.stringify({media:{id:media.id,type:media.type,imdbId:media.imdb_id,tmdbId:Number(media.tmdb_id),title:media.title,year:Number(media.year)||0},season,episode})
                });
                if (data.schema !== 'seerrcatalog.search.v1' || !Array.isArray(data.streams) || typeof data.conclusive !== 'boolean') throw new Error('Invalid Remix search response');
                complete = complete && data.conclusive;
                streams = data.streams;
            } else {
                const url = new URL(cfg.prowlarrUrl + '/api/v1/search');
                url.searchParams.set('query', media.title + (media.type === 'series' ? ` S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}` : (media.year ? ' ' + media.year : '')));
                url.searchParams.set('type', 'search'); url.searchParams.set('categories',media.type === 'series' ? '5000' : '2000'); url.searchParams.set('limit','100');
                const rows = await request(url, {headers:{'X-Api-Key':token}});
                if (!Array.isArray(rows)) throw new Error('Invalid Prowlarr response');
                streams = rows.filter(row => matches(row,media,season,episode)).map(row => ({title:row.title,name:'Prowlarr',infoHash:infoHash(row),source:String(row.indexerId || 'prowlarr')})).filter(row => row.infoHash);
            }
            // A provider remains one source for the configured source threshold.
            groups.push({ addon:{id:'supplemental:' + cfg.mode,name:cfg.mode === 'remix' ? 'Ether Remix' : 'Prowlarr',source:cfg.mode,transportUrl:cfg.mode==='remix'?cfg.remixUrl:cfg.prowlarrUrl},streams,streamId });
            if (matching(streams, filters.languageTags)) break;
        }
        // Count one checked episode per provider, as for Stremio addons.
        const chosen = groups.find(g => matching(g.streams, filters.languageTags)) ||
            (filters.subtitleFallback && filters.fallbackLanguageTags?.length && groups.find(g => matching(g.streams, filters.fallbackLanguageTags))) || groups[0];
        // Keep positive evidence even when another indexer failed. Never treat
        // missing results from a partial response as confirmed absence.
        const selected = chosen ? [{...chosen, conclusive: complete}] : [];
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        if (complete) cache.set(key,{until:Date.now()+5*60*1000,value:selected});
        return selected;
    })();
    pending.set(key,work);
    try { return await work; } finally { pending.delete(key); }
}
module.exports = {getSettings,updateSettings,testConnection,search,infoHash,matches};
