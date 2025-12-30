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
        // Trigger Radarr sync
        const radarrSyncUrl = `${config.url}/api/v1/settings/radarr/sync`;
        const headers = {
            'Content-Type': 'application/json'
        };
        if (config.apiKey) {
            headers['X-Api-Key'] = config.apiKey;
        }

        console.log('[Jellyseerr] Triggering Radarr sync...');
        const response = await fetch(radarrSyncUrl, {
            method: 'POST',
            headers
        });

        if (response.ok) {
            console.log('[Jellyseerr] ✅ Radarr sync triggered successfully');
            return true;
        } else {
            console.log(`[Jellyseerr] Sync request failed: ${response.status}`);
            return false;
        }
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

    try {
        // First, try to trigger a sync
        await triggerJellyseerrSync();

        console.log(`[Jellyseerr] Notified about available: ${media.title}`);
        return true;
    } catch (error) {
        console.error('[Jellyseerr] Notification error:', error.message);
        return false;
    }
}

module.exports = {
    getJellyseerrConfig,
    triggerJellyseerrSync,
    notifyMediaAvailable
};
