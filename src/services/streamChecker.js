/**
 * Stream checker service
 * Checks if streams are available for media items using user's Stremio addons
 */

const { checkStreamsWithUserAddons, getLibraryItems } = require('./stremio');

// Check interval: 24 hours in milliseconds
const RECHECK_INTERVAL = 24 * 60 * 60 * 1000;
const INITIAL_RETRY_DELAY = 60 * 1000;
const inFlightChecks = new Map();

function parseSettingArray(json, fallback = []) {
    if (!json) return fallback;
    try {
        const array = JSON.parse(json);
        return Array.isArray(array) ? array : fallback;
    } catch (error) {
        console.warn('[StreamChecker] Invalid array setting:', error.message);
        return fallback;
    }
}

function getFilterPrefs(db, userId) {
    return {
        languageTags: parseSettingArray(db.getSetting(`stream_filter_languages_${userId}`)),
        minResolution: db.getSetting(`stream_filter_resolution_${userId}`) || null
    };
}

function shouldNotifyNoSources(result) {
    // Zero validated releases, *not* a timeout, missing configuration or unmet threshold.
    return result.conclusive === true && result.available === false && result.streamCount === 0;
}


/**
 * Check if streams are available for a media item using the owner's addons
 * @param {Object} media - Media object
 * @param {Object} db - Database instance
 * @returns {Promise<Object>} Check result
 */
async function performStreamCheck(media, db) {
    // Get the user who owns this media
    const user = media.user_id ? db.getUserById(media.user_id) : null;

    if (!user) {
        console.log(`[StreamChecker] No media owner found for: ${media.title}`);
        return {
            available: false,
            streamCount: 0,
            reason: 'Media owner not found',
            conclusive: false,
            checkStatus: 'incomplete',
            lastChecked: new Date().toISOString()
        };
    }

    const directManifestUrls = parseSettingArray(db.getSetting(`stremio_direct_manifests_${user.id}`));

    if (!user.stremio_auth_key && directManifestUrls.length === 0) {
        console.log(`[StreamChecker] No Stremio account or direct addons for media owner: ${media.title}`);
        return {
            available: false,
            streamCount: 0,
            reason: 'Owner has no Stremio account or direct addons configured',
            conclusive: false,
            checkStatus: 'incomplete',
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
    const selectedAddonIds = selectedAddonsJson ? parseSettingArray(selectedAddonsJson) : null;

    const filterPrefs = getFilterPrefs(db, user.id);

    const availabilityPrefs = {
        minStreamCount: parseInt(db.getSetting(`stream_min_count_${user.id}`) || '1', 10),
        minAddonCount: parseInt(db.getSetting(`stream_min_addons_${user.id}`) || '1', 10)
    };

    if (filterPrefs.languageTags.length > 0 || filterPrefs.minResolution) {
        console.log(`[StreamChecker] Using filters for ${user.username}:`, filterPrefs);
    }

    console.log(
        `[StreamChecker] Availability rule for ${user.username}: ` +
        `${availabilityPrefs.minStreamCount} stream(s), ${availabilityPrefs.minAddonCount} addon(s)`
    );

    // Use account addons + optional direct manifest URLs. Direct-only mode is supported.
    return await checkStreamsWithUserAddons(
        media.type === 'series' ? { ...media, checkEpisodes: db.getEpisodes(media.id) } : media,
        user.stremio_auth_key,
        selectedAddonIds,
        filterPrefs,
        directManifestUrls,
        availabilityPrefs
    );
}

function checkStreamsAvailable(media, db) {
    // Deduplicate overlapping background, manual and initial checks for the same media.
    const key = media.id;
    if (key == null) return performStreamCheck(media, db);
    const existing = inFlightChecks.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => performStreamCheck(media, db));
    inFlightChecks.set(key, pending);
    pending.finally(() => {
        if (inFlightChecks.get(key) === pending) inFlightChecks.delete(key);
    }).catch(() => {});
    return pending;
}

/** Shared initial workflow for Radarr and Sonarr, with one delayed confirmation.
 * Never emit a "no sources" alert for configuration/network failures. */
async function handleInitialStreamCheck(media, db, origin = 'Catalog') {
    let result;
    const attempts = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY));
            console.log(`[${origin}] Confirming initial check for ${media.title}`);
        }
        if (!db.getMediaById(media.id)) return;
        try {
            result = await checkStreamsAvailable(media, db);
        } catch (error) {
            console.error(`[${origin}] Stream check failed for ${media.title}:`, error.message);
            result = { available: false, conclusive: false, checkStatus: 'incomplete', streamCount: 0 };
        }
        attempts.push(result);
        if (result.available) break;
        // No point retrying absent settings/ID during the same request; keep pending.
        if (result.reason && /no imdb|no stremio account|no media owner/i.test(result.reason)) break;
    }

    if (!db.getMediaById(media.id)) return;
    if (!result.conclusive) {
        console.warn(`[${origin}] Verification incomplete for ${media.title}; suppressing no-source notification`);
        return;
    }
    db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);

    if (result.available) {
        console.log(`[${origin}] Streams found for ${media.title} (${result.streamCount})`);
        const { notifyMediaAvailable } = require('./jellyseerr');
        await notifyMediaAvailable(media);
    } else if (attempts.length === 2 && attempts.every(shouldNotifyNoSources)) {
        const { sendNoSourceNotification } = require('./discord');
        await sendNoSourceNotification(media, getFilterPrefs(db, media.user_id));
    } else {
        console.log(`[${origin}] ${media.title}: no-source alert suppressed (unconfirmed absence or thresholds not met)`);
    }
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

        try {
            const result = await checkStreamsAvailable(media, db);
            if (!result.conclusive) {
                console.warn(`[StreamChecker] Incomplete recheck for ${media.title}; keeping previous status`);
                continue;
            }
            db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
            if (result.available) {
                console.log(`[StreamChecker] ✅ Streams now available for: ${media.title} (${result.streamCount} streams)`);
                const { notifyMediaAvailable } = require('./jellyseerr');
                await notifyMediaAvailable(media);
            }
        } catch (error) {
            console.error(`[StreamChecker] Recheck failed for ${media.title}:`, error.message);
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
    let running = false;
    async function runCycle() {
        if (running) return;
        running = true;
        try {
            await recheckUnavailableMedia(db);
            await syncWatchedState(db);
            await cleanupWatchedContent(db);
        } catch (error) {
            console.error('[StreamChecker] Background cycle failed:', error);
        } finally {
            running = false;
        }
    }

    setTimeout(runCycle, 60 * 1000);
    setInterval(runCycle, RECHECK_INTERVAL);

    console.log('[StreamChecker] Background checker started (24h interval)');
}

module.exports = {
    checkStreamsAvailable,
    handleInitialStreamCheck,
    shouldNotifyNoSources,
    getFilterPrefs,
    recheckUnavailableMedia,
    cleanupWatchedContent,
    syncWatchedState,
    startBackgroundChecker,
    RECHECK_INTERVAL
};
