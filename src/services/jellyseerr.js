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

        // Trigger Radarr sync
        const radarrSyncUrl = `${config.url}/api/v1/settings/radarr/sync`;
        console.log('[Jellyseerr] Triggering Radarr sync...');
        const radarrResponse = await fetch(radarrSyncUrl, {
            method: 'GET',
            headers
        });

        if (!radarrResponse.ok) {
            console.log(`[Jellyseerr] Radarr sync request failed: ${radarrResponse.status}`);
        } else {
            console.log('[Jellyseerr] ✅ Radarr sync triggered successfully');
        }

        // Trigger Sonarr sync
        const sonarrSyncUrl = `${config.url}/api/v1/settings/sonarr/sync`;
        console.log('[Jellyseerr] Triggering Sonarr sync...');
        const sonarrResponse = await fetch(sonarrSyncUrl, {
            method: 'GET',
            headers
        });

        if (!sonarrResponse.ok) {
            console.log(`[Jellyseerr] Sonarr sync request failed: ${sonarrResponse.status}`);
        } else {
            console.log('[Jellyseerr] ✅ Sonarr sync triggered successfully');
        }

        return radarrResponse.ok && sonarrResponse.ok;

    } catch (error) {
        console.error('[Jellyseerr] Sync trigger error:', error.message);
        return false;
    }
}

/**
 * Notify Jellyseerr that a media item is now available
 * @param {Object} media - Media object with type, tmdb_id, etc.
 * 
 * NOTE: Jellyseerr polls Sonarr/Radarr itself to check media availability
 * via hasFile (movies) and episodeFileCount (TV shows). We don't need to
 * actively notify it - it will discover the change on its next sync cycle.
 */
async function notifyMediaAvailable(media) {
    const config = getJellyseerrConfig();
    if (!config) {
        return false;
    }

    // Just log that streams are available
    // Jellyseerr will poll our Sonarr/Radarr API and see hasFile=true or episodeFileCount>0
    console.log(`[Jellyseerr] Media now available (Jellyseerr will detect on next sync): ${media.title}`);
    return true;
}

module.exports = {
    getJellyseerrConfig,
    triggerJellyseerrSync,
    notifyMediaAvailable
};
