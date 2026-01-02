/**
 * TMDB API client for searching movies and series
 * Now supports API key from database settings
 */

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';

// Get API key from environment or database
function getApiKey(db = null) {
    // Try environment first
    if (process.env.TMDB_API_KEY) {
        // console.log('[TMDB] Using API Key from env');
        return process.env.TMDB_API_KEY;
    }
    // Try database
    if (db && db.getSetting) {
        const key = db.getSetting('tmdb_api_key');
        // console.log('[TMDB] DB Key check:', key ? 'Found' : 'Missing');
        if (key) return key;
    } else {
        console.warn('[TMDB] Warning: DB instance undefined or invalid in getApiKey');
    }
    return null;
}

async function searchTMDB(query, type = 'multi', db = null) {
    const apiKey = getApiKey(db);
    if (!apiKey) {
        console.warn('[TMDB] No API key configured');
        return [];
    }

    try {
        const endpoint = type === 'multi' ? 'search/multi' : `search/${type}`;
        const url = `${TMDB_API_URL}/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        const data = await response.json();
        return data.results
            .filter(item => item.media_type === 'movie' || item.media_type === 'tv' || type !== 'multi')
            .map(item => formatTMDBResult(item, type));
    } catch (e) {
        console.error('[TMDB] Search error:', e.message);
        return [];
    }
}

async function getTMDBDetails(tmdbId, type, db = null) {
    const apiKey = getApiKey(db);
    if (!apiKey) {
        return null;
    }

    try {
        const mediaType = type === 'series' ? 'tv' : 'movie';
        const url = `${TMDB_API_URL}/${mediaType}/${tmdbId}?api_key=${apiKey}&language=fr-FR&append_to_response=external_ids`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        const item = await response.json();
        return formatTMDBResult(item, mediaType);
    } catch (e) {
        console.error('[TMDB] Details error:', e.message);
        return null;
    }
}

function formatTMDBResult(item, type) {
    const mediaType = item.media_type || type;
    const isMovie = mediaType === 'movie';

    return {
        tmdb_id: item.id,
        imdb_id: item.external_ids?.imdb_id || item.imdb_id || null,
        type: isMovie ? 'movie' : 'series',
        title: isMovie ? item.title : item.name,
        original_title: isMovie ? item.original_title : item.original_name,
        year: parseInt((isMovie ? item.release_date : item.first_air_date)?.substring(0, 4)) || null,
        overview: item.overview,
        poster: item.poster_path ? `${TMDB_IMAGE_URL}/w500${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `${TMDB_IMAGE_URL}/original${item.backdrop_path}` : null,
        genres: item.genres?.map(g => g.name) || item.genre_ids || [],
        runtime: item.runtime || item.episode_run_time?.[0] || null,
        vote_average: item.vote_average,
        popularity: item.popularity
    };
}

/**
 * Find TMDB content by external ID (TVDB, IMDB)
 */
async function findByExternalId(externalId, externalSource, db = null) {
    const apiKey = getApiKey(db);
    if (!apiKey) {
        console.warn('[TMDB] No API key configured');
        return null;
    }

    try {
        const url = `${TMDB_API_URL}/find/${externalId}?api_key=${apiKey}&external_source=${externalSource}&language=fr-FR`;
        console.log('[TMDB] Finding by external ID:', externalId, externalSource);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[TMDB] Find results:', {
            movies: data.movie_results?.length || 0,
            tv: data.tv_results?.length || 0
        });
        return data;
    } catch (e) {
        console.error('[TMDB] Find by external ID error:', e.message);
        return null;
    }
}

/**
 * Get TV show seasons and episode counts from TMDB
 */
async function getTVShowSeasons(tmdbId, db = null) {
    const apiKey = getApiKey(db);
    if (!apiKey) {
        console.warn('[TMDB] No API key configured');
        return null;
    }

    try {
        const url = `${TMDB_API_URL}/tv/${tmdbId}?api_key=${apiKey}&language=fr-FR`;
        console.log(`[TMDB] Fetching seasons for TV show ${tmdbId}`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        const data = await response.json();

        // Return simplified seasons array with episode counts
        const seasons = data.seasons
            ?.filter(s => s.season_number > 0) // Exclude specials (season 0)
            .map(s => ({
                season_number: s.season_number,
                episode_count: s.episode_count,
                name: s.name,
                air_date: s.air_date
            })) || [];

        console.log(`[TMDB] Found ${seasons.length} seasons for ${data.name}`);
        return {
            name: data.name,
            seasons: seasons,
            total_seasons: seasons.length,
            total_episodes: seasons.reduce((sum, s) => sum + s.episode_count, 0)
        };
    } catch (e) {
        console.error('[TMDB] Get TV seasons error:', e.message);
        return null;
    }
}

module.exports = {
    searchTMDB,
    getTMDBDetails,
    formatTMDBResult,
    getApiKey,
    isConfigured,
    findByExternalId,
    getTVShowSeasons
};
