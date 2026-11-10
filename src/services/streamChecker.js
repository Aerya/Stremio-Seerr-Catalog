const supplemental = require('./supplementalSearch');
/**
 * Stream checker service
 * Checks if streams are available for media items using user's Stremio addons
 */

const { checkStreamsWithUserAddons, getLibraryItems } = require('./stremio');
const { recordStreamCheck, deleteMediaWithNotification, notifyRemoval } = require('./mediaEvents');
const remix = require('./remixIntegration');

// Check interval: 24 hours in milliseconds
const RECHECK_INTERVAL = 24 * 60 * 60 * 1000;
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
        languageTags: parseSettingArray(db.getSetting(`stream_filter_languages_${userId}`), ['FRENCH', 'MULTI']),
        fallbackLanguageTags: parseSettingArray(db.getSetting(`stream_fallback_languages_${userId}`), ['VOSTFR', 'SUBFRENCH']),
        subtitleFallback: db.getSetting(`stream_subtitle_fallback_${userId}`) === 'true',
        externalSubtitles: db.getSetting(`stream_external_subtitles_${userId}`) === 'true',
        externalSubtitleLanguage: db.getSetting(`stream_external_subtitle_language_${userId}`) || 'fr',
        minResolution: db.getSetting(`stream_filter_resolution_${userId}`) || null
    };
}



/**
 * Check if streams are available for a media item using the owner's addons
 * @param {Object} media - Media object
 * @param {Object} db - Database instance
 * @returns {Promise<Object>} Check result
 */
async function performStreamCheck(media, db, { primaryOnly = false } = {}) {
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

    const searchMode = supplemental.getSettings(db).mode;
    const supplementalEnabled = searchMode === 'prowlarr' || (searchMode === 'remix' && (primaryOnly || getFilterPrefs(db,user.id).externalSubtitles || (getFilterPrefs(db, user.id).subtitleFallback && getFilterPrefs(db, user.id).fallbackLanguageTags.length > 0)));
    if (!user.stremio_auth_key && directManifestUrls.length === 0 && !supplementalEnabled) {
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
    if (primaryOnly) { filterPrefs.subtitleFallback = false; filterPrefs.externalSubtitles = false; }

    const availabilityPrefs = {
        minStreamCount: Math.max(2, parseInt(db.getSetting(`stream_min_count_${user.id}`) || '2', 10)),
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
        availabilityPrefs,
        remix.getSettings(db).enabled,
        supplementalEnabled ? ids => supplemental.search(db, media, ids, filterPrefs) : null
    );
}

function checkStreamsAvailable(media, db) {
    const current = db.getMediaById(media.id);
    if (current?.streams_available) return Promise.resolve({ available: true, conclusive: true,
        frozen: true, streamCount: current.stream_count, lastChecked: current.last_stream_check });
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

/** Explicit language upgrade only; automatic checks still freeze confirmed media. */
function checkPrimaryStreams(media, db) {
    const current = db.getMediaById(media.id);
    if (!current?.streams_available || !current.stream_filters_detail?.subtitleFallbackUsed) {
        return Promise.reject(new Error('Only confirmed fallback media can be upgraded'));
    }
    if (!getFilterPrefs(db, current.user_id).languageTags.length) {
        return Promise.reject(new Error('Configure primary language tags first'));
    }
    const key = `${media.id}:primary`;
    if (inFlightChecks.has(key)) return inFlightChecks.get(key);
    const pending = Promise.resolve().then(() => performStreamCheck(current, db, { primaryOnly: true }));
    inFlightChecks.set(key, pending);
    pending.finally(() => inFlightChecks.delete(key)).catch(() => {});
    return pending;
}

/** Shared initial workflow for Radarr and Sonarr. Pending titles follow the persisted timetable. */
async function handleInitialStreamCheck(media, db, origin = 'Catalog') {
    if (!db.getMediaById(media.id)) return;
    try {
        const result = await checkStreamsAvailable(media, db);
        await recordStreamCheck(db, media, result);
    } catch (error) {
        console.error(`[${origin}] Initial verification failed:`, error.message);
    }
}

/**
 * Background job to check all media without streams
 * @param {Object} db - Database instance
 */
async function recheckUnavailableMedia(db, externalOnly = false) {
    console.log('[StreamChecker] Starting 24h recheck of unavailable media...');

    const unavailable = db.getMediaByAvailability(false);
    for (const media of unavailable) {
        if(externalOnly && db.getSetting(`submaker_pending_${media.id}`)!=="true") continue;
        const due = media.next_search_at || (media.last_stream_check
            ? new Date(new Date(media.last_stream_check).getTime() + RECHECK_INTERVAL).toISOString() : null);
        if (due && Date.parse(due) > Date.now()) continue;

        try {
            const result = await checkStreamsAvailable(media, db);
            if (!result.conclusive) {
                await recordStreamCheck(db,media,result);
                console.warn(`[StreamChecker] Incomplete recheck for ${media.title}; keeping previous status`);
                continue;
            }
            const update = await recordStreamCheck(db, media, result);
            if (update.newlyAvailable) {
                console.log(`[StreamChecker] ✅ Streams now available for: ${media.title} (${result.streamCount} streams)`);
            }
        } catch (error) {
            console.error(`[StreamChecker] Recheck failed for ${media.title}:`, error.message);
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
            const deleted = deleteMediaWithNotification(db, movie, 'watched');
            if (deleted.changes) console.log(`[Cleanup] 🗑️ Removed watched movie: ${movie.title} (user ${movie.user_id})`);
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
                const deleted = deleteMediaWithNotification(db, series, 'watched');
                if (deleted.changes) console.log(`[Cleanup] 🗑️ Removed fully watched series: ${series.title} (${status.total} episodes, user ${series.user_id})`);
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
                const marked = db.markAsWatched(m.id, autoCleanup === 'true');
                if (autoCleanup === 'true') {
                    notifyRemoval(m, marked, 'watched', undefined, db);
                    console.log(`[StreamChecker] 🗑️ Auto-deleted watched content: ${m.title} (user ${user.username})`);
                }
            }
        }
    }
}

/**
 * Start the hourly scheduler; only pending titles whose deadline has passed are checked.
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
    setInterval(runCycle, 60 * 60 * 1000);
    setInterval(async()=>{if(running)return;running=true;try{await recheckUnavailableMedia(db,true);}catch(error){console.error('[StreamChecker] Pending subtitle check failed');}finally{running=false}},5*60*1000);

    console.log('[StreamChecker] Background checker started (hourly wake; J+1/J+3 then daily pending searches)');
}

module.exports = {
    checkStreamsAvailable,
    checkPrimaryStreams,
    handleInitialStreamCheck,
    getFilterPrefs,
    recheckUnavailableMedia,
    cleanupWatchedContent,
    syncWatchedState,
    startBackgroundChecker,
    RECHECK_INTERVAL
};
