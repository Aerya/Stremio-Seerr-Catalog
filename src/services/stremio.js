/**
 * Stremio API Service
 * Fetches installed addons from a user's Stremio account
 */

const STREMIO_API_URL = 'https://api.strem.io/api';

/**
 * Get installed addons for a Stremio user
 * @param {string} authKey - User's Stremio authentication key
 * @returns {Promise<Array>} List of installed addons with stream capability
 */
async function getInstalledAddons(authKey) {
    if (!authKey) {
        throw new Error('No Stremio auth key provided');
    }

    try {
        const response = await fetch(`${STREMIO_API_URL}/addonCollectionGet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'AddonCollectionGet',
                authKey: authKey
            })
        });

        if (!response.ok) {
            throw new Error(`Stremio API error: ${response.status}`);
        }

        const data = await response.json();

        // API returns { result: { addons: [...] } }
        const addons = data.result?.addons || data.addons || [];

        if (!Array.isArray(addons) || addons.length === 0) {
            console.log('[Stremio] No addons found or invalid response');
            return [];
        }

        console.log(`[Stremio] Total addons from API: ${addons.length}`);

        // Filter addons that have stream capability
        const streamAddons = addons.filter(addon => {
            const resources = addon.manifest?.resources || [];
            // Check if 'stream' is in resources (can be string or object with name property)
            return resources.some(r =>
                r === 'stream' ||
                (typeof r === 'object' && r.name === 'stream')
            );
        });

        console.log(`[Stremio] Found ${streamAddons.length} stream-capable addons`);

        return streamAddons.map(addon => ({
            id: addon.manifest?.id || 'unknown',
            name: addon.manifest?.name || 'Unknown Addon',
            version: addon.manifest?.version || '0.0.0',
            transportUrl: addon.transportUrl,
            types: addon.manifest?.types || []
        }));

    } catch (error) {
        console.error('[Stremio] Failed to get addons:', error.message);
        throw error;
    }
}

/**
 * Check if streams are available for a media item using user's addons
 * @param {Object} media - Media object with type, imdb_id, tmdb_id
 * @param {string} authKey - User's Stremio authentication key
 * @param {Array} selectedAddonIds - Optional array of addon IDs to check (if empty, checks all)
 * @returns {Promise<Object>} { available: boolean, streamCount: number, addons: Array with detailed streams }
 */
async function checkStreamsWithUserAddons(media, authKey, selectedAddonIds = null) {
    // Get IMDB ID (required for stream lookups)
    let imdbId = media.imdb_id;

    if (!imdbId && media.tmdb_id) {
        // Try to get IMDB ID from Cinemeta
        imdbId = await getImdbIdFromTmdb(media.type, media.tmdb_id);
    }

    if (!imdbId) {
        console.log(`[Stremio] No IMDB ID for: ${media.title}`);
        return {
            available: false,
            streamCount: 0,
            reason: 'No IMDB ID',
            lastChecked: new Date().toISOString()
        };
    }

    // Get user's installed addons
    let addons;
    try {
        addons = await getInstalledAddons(authKey);
    } catch (error) {
        return {
            available: false,
            streamCount: 0,
            reason: `Failed to get addons: ${error.message}`,
            lastChecked: new Date().toISOString()
        };
    }

    if (addons.length === 0) {
        return {
            available: false,
            streamCount: 0,
            reason: 'No stream addons installed',
            lastChecked: new Date().toISOString()
        };
    }

    // Filter to selected addons if provided
    if (selectedAddonIds && selectedAddonIds.length > 0) {
        addons = addons.filter(a => selectedAddonIds.includes(a.id));
        console.log(`[Stremio] Filtering to ${addons.length} selected addons`);
    }

    let totalStreams = 0;
    const type = media.type === 'movie' ? 'movie' : 'series';
    const checkedAddons = [];

    // Check each addon for streams
    for (const addon of addons) {
        // Skip addons that don't support this type
        if (!addon.types.includes(type)) {
            console.log(`[Stremio] Skipping ${addon.name} - doesn't support ${type}`);
            continue;
        }

        try {
            // Fix: transportUrl often ends with /manifest.json - remove it to build correct stream URL
            let baseUrl = addon.transportUrl;
            if (baseUrl.endsWith('/manifest.json')) {
                baseUrl = baseUrl.slice(0, -'/manifest.json'.length);
            }

            // For series, Stremio expects format imdbId:season:episode
            // We check S01E01 by default to see if series has any streams
            const streamId = type === 'series' ? `${imdbId}:1:1` : imdbId;
            const streamUrl = `${baseUrl}/stream/${type}/${streamId}.json`;
            console.log(`[Stremio] Checking addon: ${addon.name} (${type}${type === 'series' ? ' S01E01' : ''})`);

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(streamUrl, { signal: controller.signal });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                const streams = data.streams || [];
                const streamCount = streams.length;
                console.log(`[Stremio] ${addon.name} returned ${streamCount} streams`);

                // Debug: log first stream's fields to understand structure
                if (streams.length > 0) {
                    const s = streams[0];
                    console.log(`[Stremio] Sample stream fields: name="${s.name}", title="${s.title}", description="${s.description?.substring(0, 100)}...", behaviorHints.filename="${s.behaviorHints?.filename}"`);
                }

                if (streamCount > 0) {
                    totalStreams += streamCount;
                    // Capture detailed stream info - use best available name
                    const streamDetails = streams.slice(0, 10).map(s => {
                        // Get the best release name - priority: behaviorHints.filename > first line of description > title > name
                        let displayName = 'Unknown';

                        // behaviorHints.filename often has the real torrent name
                        if (s.behaviorHints?.filename) {
                            displayName = s.behaviorHints.filename;
                        }
                        // description first line often has the release name
                        else if (s.description) {
                            displayName = s.description.split('\n')[0].trim();
                        }
                        // title (for UsenetStreamer etc.)
                        else if (s.title) {
                            displayName = s.title.split('\n')[0].trim();
                        }
                        // fallback to name
                        else if (s.name) {
                            displayName = s.name;
                        }

                        // Clean up: remove emojis at start, HTML tags
                        displayName = displayName.replace(/<[^>]*>/g, ' ').trim();

                        return {
                            name: displayName,
                            title: s.title || '',
                            quality: extractQuality(displayName + ' ' + (s.name || '')),
                            size: extractSize(displayName + ' ' + (s.title || '') + ' ' + (s.description || ''))
                        };
                    });
                    checkedAddons.push({
                        id: addon.id,
                        name: addon.name,
                        streamCount,
                        streams: streamDetails
                    });
                }
            } else {
                console.log(`[Stremio] ${addon.name} returned error: ${response.status}`);
            }
        } catch (error) {
            console.log(`[Stremio] Check failed for ${addon.name}: ${error.message}`);
        }
    }

    console.log(`[Stremio] ${media.title}: ${totalStreams} streams from ${checkedAddons.length} addons`);

    return {
        available: totalStreams > 0,
        streamCount: totalStreams,
        addons: checkedAddons,
        lastChecked: new Date().toISOString()
    };
}

// Helper to extract quality from stream name
function extractQuality(name) {
    const match = name.match(/\b(4K|2160p|1080p|720p|480p|HDR|DV|Dolby Vision)\b/i);
    return match ? match[1].toUpperCase() : '';
}

// Helper to extract size from stream name
function extractSize(name) {
    const match = name.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB))\b/i);
    return match ? match[1] : '';
}

/**
 * Get IMDB ID from TMDB ID using Cinemeta
 */
async function getImdbIdFromTmdb(type, tmdbId) {
    try {
        const cinemata = 'https://v3-cinemeta.strem.io';
        const response = await fetch(
            `${cinemata}/meta/${type === 'movie' ? 'movie' : 'series'}/tmdb:${tmdbId}.json`
        );

        if (response.ok) {
            const data = await response.json();
            return data.meta?.imdb_id || data.meta?.id || null;
        }
    } catch (error) {
        console.error('[Stremio] Failed to get IMDB ID from Cinemeta:', error.message);
    }

    return null;
}

/**
 * Test if a Stremio auth key is valid
 * @param {string} authKey - Auth key to test
 * @returns {Promise<Object>} { valid: boolean, addonsCount: number, error?: string }
 */
async function testAuthKey(authKey) {
    try {
        const addons = await getInstalledAddons(authKey);
        return {
            valid: true,
            addonsCount: addons.length,
            addons: addons.map(a => a.name)
        };
    } catch (error) {
        return {
            valid: false,
            addonsCount: 0,
            error: error.message
        };
    }
}

/**
 * Login to Stremio with email and password
 * @param {string} email - Stremio account email
 * @param {string} password - Stremio account password
 * @returns {Promise<Object>} { success: boolean, authKey?: string, error?: string }
 */
async function loginWithCredentials(email, password) {
    try {
        const response = await fetch(`${STREMIO_API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'Login',
                email: email,
                password: password,
                facebook: false
            })
        });

        const data = await response.json();

        if (data.error) {
            return {
                success: false,
                error: data.error
            };
        }

        // API returns { result: { authKey: "...", user: {...} } }
        const authKey = data.result?.authKey || data.authKey;
        const userEmail = data.result?.user?.email || data.email || email;

        if (!authKey) {
            console.log('[Stremio] Response:', JSON.stringify(data));
            return {
                success: false,
                error: 'No authKey in response'
            };
        }

        console.log(`[Stremio] Login successful for: ${email}`);

        // Test the auth key by fetching addons
        const addons = await getInstalledAddons(authKey);

        return {
            success: true,
            authKey: authKey,
            email: userEmail,
            addonsCount: addons.length,
            addons: addons.map(a => a.name)
        };


    } catch (error) {
        console.error('[Stremio] Login failed:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    getInstalledAddons,
    checkStreamsWithUserAddons,
    getImdbIdFromTmdb,
    testAuthKey,
    loginWithCredentials
};

