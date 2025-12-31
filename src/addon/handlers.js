const db = require('../db');

/**
 * Convert database media to Stremio meta preview format
 */
function toMetaPreview(media) {
    const id = media.imdb_id || `tmdb:${media.tmdb_id}`;

    // Build name with status indicators
    let name = media.title;

    return {
        id,
        type: media.type,
        name,
        poster: media.poster,
        posterShape: 'poster',
        year: media.year,
        imdbId: media.imdb_id,
        ...(media.genres && { genres: media.genres }),
        // Custom properties for UI (may not be used by Stremio but useful)
        links: [
            ...(media.streams_available ? [{ name: `${media.stream_count} streams`, category: 'Streams', url: '#' }] : []),
            ...(media.watched ? [{ name: 'Watched', category: 'Status', url: '#' }] : [])
        ]
    };
}

/**
 * Convert database media to full Stremio meta format
 */
function toMeta(media) {
    const preview = toMetaPreview(media);

    return {
        ...preview,
        description: media.overview,
        background: media.backdrop,
        runtime: media.runtime ? `${media.runtime} min` : undefined,
        ...(media.type === 'series' && {
            videos: getSeriesVideos(media)
        })
    };
}

/**
 * Get videos (episodes) for a series
 */
function getSeriesVideos(media) {
    const episodes = db.getEpisodes(media.id);

    return episodes.map(ep => ({
        id: `${media.imdb_id || `tmdb:${media.tmdb_id}`}:${ep.season_number}:${ep.episode_number}`,
        title: ep.title || `Episode ${ep.episode_number}`,
        season: ep.season_number,
        episode: ep.episode_number,
        overview: ep.overview,
        released: ep.air_date
    }));
}

/**
 * Parse catalog ID to determine filters
 */
function parseCatalogId(id) {
    const filters = {};

    if (id.includes('available') && !id.includes('unavailable')) {
        filters.available = true;
    } else if (id.includes('unavailable')) {
        filters.available = false;
    }

    if (id.includes('watched')) {
        filters.watched = true;
    }

    if (id.includes('series')) {
        filters.type = 'series';
    } else if (id.includes('movie')) {
        filters.type = 'movie';
    }

    return filters;
}

/**
 * Catalog handler - returns list of media
 */
function catalogHandler(args) {
    const { type, id, extra, userId } = args;

    let filters = parseCatalogId(id);

    if (!filters.type) {
        filters.type = type;
    }

    if (extra && extra.search) {
        filters.search = extra.search;
    }

    // Filter by userId ONLY if explicitly provided (user-specific catalog)
    // Global catalog shows all media regardless of user
    if (userId !== undefined && userId !== null) {
        filters.userId = userId;
    }

    let media = db.getFilteredMedia(filters);

    const skip = extra?.skip ? parseInt(extra.skip) : 0;
    media = media.slice(skip, skip + 100);

    const metas = media.map(toMetaPreview);

    return Promise.resolve({ metas });
}

/**
 * Meta handler - returns details for a single media item
 */
function metaHandler(args) {
    const { type, id } = args;

    let media = null;

    // Try to find by IMDB ID first
    if (id.startsWith('tt')) {
        media = db.getMediaByImdb(id);
    }
    // Try TMDB ID
    else if (id.startsWith('tmdb:')) {
        const tmdbId = parseInt(id.replace('tmdb:', ''));
        media = db.getMediaByTmdb(type, tmdbId);
    }

    if (!media) {
        return Promise.resolve({ meta: null });
    }

    return Promise.resolve({ meta: toMeta(media) });
}

module.exports = {
    catalogHandler,
    metaHandler,
    toMetaPreview,
    toMeta
};
