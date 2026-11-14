const { getApiKey } = require('./tmdb');

// Release tags are not language codes: never guess a language for MULTI/VO
// or a custom expression. Keep this mapping independent of the WebUI language.
const aliases = {
    fr: ['FRENCH', 'FR', 'FRA', 'FRE', 'FRANÇAIS', 'FRANCAIS', 'VFF', 'VF', 'VFQ', 'VFI', 'TRUEFRENCH'],
    en: ['ENGLISH', 'EN', 'ENG', 'ANGLAIS'],
    de: ['GERMAN', 'DE', 'DEU', 'GER', 'DEUTSCH'],
    es: ['SPANISH', 'ES', 'SPA', 'ESPAÑOL', 'CASTELLANO', 'LATINO'],
    it: ['ITALIAN', 'IT', 'ITA', 'ITALIANO'],
    pt: ['PORTUGUESE', 'PT', 'POR', 'PORTUGUÊS', 'BRAZILIAN'],
    ja: ['JAPANESE', 'JA', 'JPN'], ko: ['KOREAN', 'KO', 'KOR'],
    zh: ['CHINESE', 'ZH', 'ZHO', 'CHI', 'MANDARIN'], ru: ['RUSSIAN', 'RU', 'RUS'],
    ar: ['ARABIC', 'AR', 'ARA'], nl: ['DUTCH', 'NL', 'NLD', 'DUT'],
    pl: ['POLISH', 'PL', 'POL'], tr: ['TURKISH', 'TR', 'TUR'],
    hi: ['HINDI', 'HI', 'HIN'], uk: ['UKRAINIAN', 'UK', 'UKR'],
    sv: ['SWEDISH', 'SV', 'SWE'], no: ['NORWEGIAN', 'NO', 'NOR'],
    da: ['DANISH', 'DA', 'DAN'], fi: ['FINNISH', 'FI', 'FIN'],
    cs: ['CZECH', 'CS', 'CES', 'CZE'], el: ['GREEK', 'EL', 'ELL', 'GRE'],
    he: ['HEBREW', 'HE', 'HEB'], hu: ['HUNGARIAN', 'HU', 'HUN'], ro: ['ROMANIAN', 'RO', 'RON', 'RUM']
};
function requestedLanguages(db, userId) {
    if (userId == null) return [];
    let tags;
    try { tags = JSON.parse(db.getSetting(`stream_filter_languages_${userId}`) || '["FRENCH","MULTI"]'); }
    catch { return []; }
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.slice(0, 2).flatMap(tag => {
        if (typeof tag !== 'string') return [];
        const normalized = tag.trim().toUpperCase();
        const code = Object.keys(aliases).find(code => aliases[code].includes(normalized) ||
            new RegExp(`^${code}-[A-Z]{2}$`, 'i').test(normalized));
        return code ? [code] : [];
    }))];
}

function createTrailerService({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
    const cache = new Map();
    async function videos(type, id, language, apiKey) {
        const key = `${type}:${id}:${language}`;
        const cached = cache.get(key);
        if (cached && cached.expires > now()) return cached.promise;
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        const entry = { expires: now() + 86400000 };
        entry.promise = (async () => {
            try {
                const url = new URL(`https://api.themoviedb.org/3/${type}/${id}/videos`);
                url.searchParams.set('api_key', apiKey);
                url.searchParams.set('language', language);
                const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
                if (!response.ok) throw new Error('TMDB unavailable');
                const data = await response.json();
                if (!Array.isArray(data.results)) throw new Error('Invalid TMDB response');
                return data.results.filter(video => video && video.site === 'YouTube' &&
                    video.type === 'Trailer' && video.iso_639_1 === language &&
                    typeof video.key === 'string' && /^[A-Za-z0-9_-]{11}$/.test(video.key))
                    .sort((a, b) => Number(b.official === true) - Number(a.official === true))
                    .map(video => ({ source: video.key, type: 'Trailer' }));
            } catch {
                // Failed enrichment must not hide the media, leak the API key,
                // or hammer TMDB on each opening of the details page.
                entry.expires = now() + 300000;
                return [];
            }
        })();
        cache.set(key, entry);
        return entry.promise;
    }
    return async function getTrailers(media, db, userId = media.user_id) {
        const apiKey = getApiKey(db);
        const languages = requestedLanguages(db, userId);
        if (!apiKey || !languages.length || !Number.isSafeInteger(Number(media.tmdb_id)) || Number(media.tmdb_id) <= 0 ||
            !['movie', 'series'].includes(media.type)) return [];
        const groups = await Promise.all(languages.map(language => videos(
            media.type === 'series' ? 'tv' : 'movie', Number(media.tmdb_id), language, apiKey)));
        return [...new Map(groups.flat().map(video => [video.source, video])).values()].slice(0, 4);
    };
}
module.exports = { requestedLanguages, createTrailerService, getTrailers: createTrailerService() };
