/**
 * Stream checker service
 * Checks if streams are available for media items using user's Stremio addons
 */

const { checkStreamsWithUserAddons, getImdbIdFromTmdb, getLibraryItems } = require('./stremio');

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

    // Get user's stream filter preferences
    const languageTagsJson = db.getSetting(`stream_filter_languages_${user.id}`);
    const minResolution = db.getSetting(`stream_filter_resolution_${user.id}`);

    const filterPrefs = {
        languageTags: languageTagsJson ? JSON.parse(languageTagsJson) : [],
        minResolution: minResolution || null
    };

    if (filterPrefs.languageTags.length > 0 || filterPrefs.minResolution) {
        console.log(`[StreamChecker] Using filters for ${user.username}:`, filterPrefs);
    }

    // Use the Stremio service to check with user's addons and filters
    return await checkStreamsWithUserAddons(media, user.stremio_auth_key, selectedAddonIds, filterPrefs);
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
        // No Discord notification on recheck - only on initial add via Radarr/Sonarr

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[StreamChecker] Recheck complete');
}

/**
 * Cleanup watched content
 * - Movies: delete if watched
 * - Series: delete if ALL episodes are watched
 * Only deletes content for users with auto-cleanup enabled
 * @param {Object} db - Database instance
 */
async function cleanupWatchedContent(db) {
    console.log('[StreamChecker] Starting cleanup of watched content...');

    // Cleanup watched movies
    const watchedMovies = db.getWatchedMediaByType('movie');
    for (const movie of watchedMovies) {
        // Check if user has auto-cleanup enabled
        const autoCleanup = db.getSetting(`auto_cleanup_${movie.user_id}`);
        if (autoCleanup === 'true') {
            db.deleteMedia(movie.id);
            console.log(`[Cleanup] 🗑️ Removed watched movie: ${movie.title} (user ${movie.user_id})`);
        }
    }

    // Cleanup fully watched series
    const allSeries = db.getMediaByType('series');
    for (const series of allSeries) {
        const status = db.getEpisodesWatchedStatus(series.id);

        // Only delete if there are episodes AND all are watched
        if (status.allWatched) {
            // Check if user has auto-cleanup enabled
            const autoCleanup = db.getSetting(`auto_cleanup_${series.user_id}`);
            if (autoCleanup === 'true') {
                db.deleteMedia(series.id);
                console.log(`[Cleanup] 🗑️ Removed fully watched series: ${series.title} (${status.total} episodes, user ${series.user_id})`);
            }
        }
    }

    console.log('[StreamChecker] Cleanup complete');
}

/**
 * Sync watched state from Stremio for all users (90% threshold)
 * Marks media as watched if Stremio reports >= 90% progress
 * @param {Object} db - Database instance
 */
async function syncWatchedState(db) {
    const WATCHED_THRESHOLD = 0.9;
    const users = db.getAllUsers();

    for (const user of users) {
        if (!user.stremio_auth_key) continue;

        // Get all unwatched media for this user that have an IMDB ID
        const media = db.getFilteredMedia({ userId: user.id, watched: false });
        const mediaWithImdb = media.filter(m => m.imdb_id);

        if (mediaWithImdb.length === 0) continue;

        const imdbIds = mediaWithImdb.map(m => m.imdb_id);
        console.log(`[StreamChecker] Syncing watched state for ${user.username} (${imdbIds.length} items)`);

        const libraryItems = await getLibraryItems(user.stremio_auth_key, imdbIds);

        for (const m of mediaWithImdb) {
            const state = libraryItems[m.imdb_id];
            if (!state) continue;

            let isWatched = false;

            if (state.duration > 0) {
                // Use progress percentage
                const progress = state.timeWatched / state.duration;
                if (progress >= WATCHED_THRESHOLD) {
                    isWatched = true;
                    console.log(`[StreamChecker] ✅ ${m.title} watched at ${Math.round(progress * 100)}% by ${user.username}`);
                }
            } else if (state.watched) {
                // Stremio already marked it as watched
                isWatched = true;
                console.log(`[StreamChecker] ✅ ${m.title} marked as watched by Stremio for ${user.username}`);
            }

            if (isWatched) {
                const autoCleanup = db.getSetting(`auto_cleanup_${user.id}`);
                db.markAsWatched(m.id, autoCleanup === 'true');
                if (autoCleanup === 'true') {
                    console.log(`[StreamChecker] 🗑️ Auto-deleted watched content: ${m.title} (user ${user.username})`);
                }
            }
        }
    }
}

/**
 * Start the background checker (runs every 24 hours)
 * @param {Object} db - Database instance
 */
function startBackgroundChecker(db) {
    // Initial check after 1 minute
    setTimeout(() => {
        recheckUnavailableMedia(db);
        syncWatchedState(db).catch(console.error);
        cleanupWatchedContent(db);
    }, 60 * 1000);

    // Then every 24 hours
    setInterval(() => {
        recheckUnavailableMedia(db);
        syncWatchedState(db).catch(console.error);
        cleanupWatchedContent(db);
    }, RECHECK_INTERVAL);

    console.log('[StreamChecker] Background checker started (24h interval)');
}

module.exports = {
    checkStreamsAvailable,
    recheckUnavailableMedia,
    cleanupWatchedContent,
    syncWatchedState,
    startBackgroundChecker,
    RECHECK_INTERVAL
};
