/**
 * Stream checker service
 * Checks if streams are available for media items using user's Stremio addons
 */

const { checkStreamsWithUserAddons, getImdbIdFromTmdb } = require('./stremio');

// Check interval: 24 hours in milliseconds
const RECHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Check if streams are available for a media item using the owner's addons
 * @param {Object} media - Media object
 * @param {Object} db - Database instance
 * @returns {Promise<Object>} Check result
 */
async function checkStreamsAvailable(media, db) {
    // Get the user who owns this media
    const user = media.user_id ? db.getUserById(media.user_id) : null;

    if (!user || !user.stremio_auth_key) {
        console.log(`[StreamChecker] No Stremio auth key for media owner: ${media.title}`);
        return {
            available: false,
            streamCount: 0,
            reason: 'Owner has no Stremio auth key configured',
            lastChecked: new Date().toISOString()
        };
    }

    // If no IMDB ID but has TMDB ID, fetch it from TMDB and update DB
    if (!media.imdb_id && media.tmdb_id) {
        console.log(`[StreamChecker] Fetching IMDB ID for: ${media.title}`);
        try {
            const { getTMDBDetails } = require('./tmdb');
            const type = media.type === 'movie' ? 'movie' : 'series';
            const details = await getTMDBDetails(media.tmdb_id, type, db);
            if (details && details.imdb_id) {
                media.imdb_id = details.imdb_id;
                // Update in database
                db.db.prepare('UPDATE media SET imdb_id = ? WHERE id = ?').run(details.imdb_id, media.id);
                console.log(`[StreamChecker] Updated IMDB ID for ${media.title}: ${details.imdb_id}`);
            }
        } catch (e) {
            console.error(`[StreamChecker] Failed to fetch IMDB ID for ${media.title}:`, e.message);
        }
    }

    // Get user's selected addons (if configured)
    const selectedAddonsJson = db.getSetting(`stremio_selected_addons_${user.id}`);
    const selectedAddonIds = selectedAddonsJson ? JSON.parse(selectedAddonsJson) : null;

    // Use the Stremio service to check with user's addons
    return await checkStreamsWithUserAddons(media, user.stremio_auth_key, selectedAddonIds);
}

/**
 * Background job to check all media without streams
 * @param {Object} db - Database instance
 */
async function recheckUnavailableMedia(db) {
    console.log('[StreamChecker] Starting 24h recheck of unavailable media...');

    const unavailable = db.getMediaByAvailability(false);
    console.log(`[StreamChecker] Found ${unavailable.length} items to recheck`);

    for (const media of unavailable) {
        // Skip if checked less than 24h ago
        if (media.last_stream_check) {
            const lastCheck = new Date(media.last_stream_check).getTime();
            const now = Date.now();
            if (now - lastCheck < RECHECK_INTERVAL) {
                continue;
            }
        }

        const result = await checkStreamsAvailable(media, db);
        db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);

        if (result.available) {
            console.log(`[StreamChecker] ✅ Streams now available for: ${media.title} (${result.streamCount} streams)`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[StreamChecker] Recheck complete');
}

/**
 * Cleanup watched content
 * - Movies: delete if watched
 * - Series: delete if ALL episodes are watched
 * @param {Object} db - Database instance
 */
async function cleanupWatchedContent(db) {
    console.log('[StreamChecker] Starting cleanup of watched content...');

    // Cleanup watched movies
    const watchedMovies = db.getWatchedMediaByType('movie');
    for (const movie of watchedMovies) {
        db.deleteMedia(movie.id);
        console.log(`[Cleanup] 🗑️ Removed watched movie: ${movie.title}`);
    }

    // Cleanup fully watched series
    const allSeries = db.getMediaByType('series');
    for (const series of allSeries) {
        const status = db.getEpisodesWatchedStatus(series.id);

        // Only delete if there are episodes AND all are watched
        if (status.allWatched) {
            db.deleteMedia(series.id);
            console.log(`[Cleanup] 🗑️ Removed fully watched series: ${series.title} (${status.total} episodes)`);
        }
    }

    console.log('[StreamChecker] Cleanup complete');
}

/**
 * Start the background checker (runs every 24 hours)
 * @param {Object} db - Database instance
 */
function startBackgroundChecker(db) {
    // Initial check after 1 minute
    setTimeout(() => {
        recheckUnavailableMedia(db);
        cleanupWatchedContent(db);
    }, 60 * 1000);

    // Then every 24 hours
    setInterval(() => {
        recheckUnavailableMedia(db);
        cleanupWatchedContent(db);
    }, RECHECK_INTERVAL);

    console.log('[StreamChecker] Background checker started (24h interval)');
}

module.exports = {
    checkStreamsAvailable,
    recheckUnavailableMedia,
    cleanupWatchedContent,
    startBackgroundChecker,
    RECHECK_INTERVAL
};
