/**
 * Jellyseerr notification service
 * Notifies Jellyseerr when media status changes in SeerrCatalog
 */

const db = require('../db');

/**
 * Get Jellyseerr API configuration from settings
 */
function getJellyseerrConfig() {
    const url = db.getSetting('jellyseerr_url');
    const apiKey = db.getSetting('jellyseerr_api_key');

    if (!url) {
        return null;
    }

    return {
        url: url.replace(/\/$/, ''), // Remove trailing slash
        apiKey: apiKey || ''
    };
}

/**
 * Trigger Jellyseerr to re-sync with Radarr/Sonarr
 * This makes Jellyseerr re-poll our emulated APIs and see updated status
 */
/**
 * Trigger Jellyseerr to run the "Jellyfin Recently Added Scan" job
 * This forces Jellyseerr to check our /Items/Latest endpoint immediately
 */
async function triggerJellyseerrSync() {
    const config = getJellyseerrConfig();
    if (!config) {
        console.log('[Jellyseerr] No Jellyseerr URL configured, skipping sync notification');
        return false;
    }

    try {
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        const headers = {
            'Content-Type': 'application/json'
        };
        if (config.apiKey) {
            headers['X-Api-Key'] = config.apiKey;
        }

        // Trigger Jellyfin Recently Added Scan
        // Job ID for Jellyfin Recently Added Scan is usually 'jellyfin-recently-added-sync'
        const syncUrl = `${config.url}/api/v1/settings/jobs/jellyfin-recently-added-sync/run`;
        console.log('[Jellyseerr] Triggering Jellyfin Recently Added Scan job...');

        const response = await fetch(syncUrl, {
            method: 'POST',
            headers
        });

        if (!response.ok) {
            console.log(`[Jellyseerr] Sync job trigger failed: ${response.status} ${response.statusText}`);
            // Fallback: try full scan if recently added fails or doesn't exist?
            // But usually this ID is standard.
        } else {
            console.log('[Jellyseerr] ✅ Sync job triggered successfully');
        }

        return response.ok;

    } catch (error) {
        console.error('[Jellyseerr] Sync trigger error:', error.message);
        return false;
    }
}

/**
 * Notify Jellyseerr that a media item is now available
 * @param {Object} media - Media object with type, tmdb_id, etc.
 */
async function notifyMediaAvailable(media) {
    const config = getJellyseerrConfig();
    if (!config) {
        return false;
    }

    console.log(`[Jellyseerr] Media available: ${media.title}. Triggering sync...`);

    // Trigger the Jellyseerr job to scan for new items
    return await triggerJellyseerrSync();
}

module.exports = {
    getJellyseerrConfig,
    triggerJellyseerrSync,
    notifyMediaAvailable
};
