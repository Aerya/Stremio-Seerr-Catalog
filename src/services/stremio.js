/**
 * Stremio API Service
 * Fetches installed addons from a user's Stremio account
 */

const STREMIO_API_URL = 'https://api.strem.io/api';
const ADDON_CACHE_MS = 60 * 1000;
const accountAddonsCache = new Map();
const directAddonsCache = new Map();
const directAddonsInflight = new Map();
const MAX_CONCURRENT_STREAM_REQUESTS = 4;
let activeStreamRequests = 0;
const streamRequestWaiters = [];

async function withStreamPermit(task) {
    if (activeStreamRequests < MAX_CONCURRENT_STREAM_REQUESTS) {
        activeStreamRequests++;
    } else {
        await new Promise(resolve => streamRequestWaiters.push(resolve));
    }
    try {
        return await task();
    } finally {
        const next = streamRequestWaiters.shift();
        if (next) next();
        else activeStreamRequests--;
    }
}

function getCached(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires > Date.now()) return entry.value;
    cache.delete(key);
    return null;
}

function setCached(cache, key, value) {
    // Bound cache growth, including after Stremio auth keys are rotated.
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ADDON_CACHE_MS });
    return value;
}


function hasStreamResource(manifest) {
    const resources = manifest?.resources || [];
    return resources.some(resource =>
        resource === 'stream' ||
        (resource && typeof resource === 'object' && resource.name === 'stream')
    );
}

function addonSupportsType(addon, type) {
    // Explicit type declarations take precedence; generic stream resources support both types.
    if (Array.isArray(addon.types) && addon.types.length > 0) return addon.types.includes(type);
    return (addon.resources || []).some(resource =>
        resource === 'stream' ||
        (resource?.name === 'stream' &&
            (!Array.isArray(resource.types) || resource.types.length === 0 || resource.types.includes(type)))
    );
}

function normalizeManifestUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') throw new Error('Invalid manifest URL');
    const url = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Manifest URL must use http or https');

    if (!/\/manifest\.json\/?$/i.test(url.pathname)) {
        url.pathname = `${url.pathname.replace(/\/$/, '')}/manifest.json`;
    }
    return url.toString();
}

function buildResourceUrl(manifestUrl, resource, type, id) {
    const url = new URL(normalizeManifestUrl(manifestUrl));
    url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '') + `/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    return url.toString();
}

function manifestToAddon(manifest, transportUrl, source = 'account') {
    return {
        id: manifest?.id || transportUrl,
        name: manifest?.name || 'Unknown Addon',
        version: manifest?.version || '0.0.0',
        transportUrl: normalizeManifestUrl(transportUrl),
        types: Array.isArray(manifest?.types) ? manifest.types : [],
        resources: Array.isArray(manifest?.resources) ? manifest.resources : [],
        source
    };
}

async function fetchDirectAddon(manifestUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(manifestUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        if (!hasStreamResource(manifest)) return null;
        return manifestToAddon(manifest, manifestUrl, 'direct');
    } finally {
        clearTimeout(timeout);
    }
}

async function getDirectAddons(manifestUrls = [], diagnostics = null) {
    if (!Array.isArray(manifestUrls)) return [];
    const addons = [];
    const seenUrls = new Set();
    for (const rawUrl of manifestUrls) {
        try {
            const manifestUrl = normalizeManifestUrl(rawUrl);
            if (seenUrls.has(manifestUrl)) continue;
            seenUrls.add(manifestUrl);

            let addon = getCached(directAddonsCache, manifestUrl);
            if (!addon) {
                let pending = directAddonsInflight.get(manifestUrl);
                if (!pending) {
                    pending = fetchDirectAddon(manifestUrl);
                    directAddonsInflight.set(manifestUrl, pending);
                }
                try {
                    addon = await pending;
                    if (addon) setCached(directAddonsCache, manifestUrl, addon);
                } finally {
                    if (directAddonsInflight.get(manifestUrl) === pending) {
                        directAddonsInflight.delete(manifestUrl);
                    }
                }
            }
            if (addon) addons.push(addon);
        } catch (error) {
            if (diagnostics) diagnostics.failed++;
            console.log(`[Stremio] Failed to load direct addon manifest: ${error.message}`);
        }
    }
    return addons;
}

function getStreamSearchText(stream) {
    const tags = Array.isArray(stream?.tag) ? stream.tag.join(' ') : (stream?.tag || '');
    return [
        stream?.behaviorHints?.filename,
        stream?.description,
        stream?.title,
        stream?.name,
        stream?.quality,
        tags
    ].filter(Boolean).join(' ');
}

function isMeaningfulStream(stream) {
    if (!stream || typeof stream !== 'object') return false;

    const text = getStreamSearchText(stream).toLowerCase();
    const obviousError = /(?:^|\b)error\s*:/i.test(text) && /(no releases?|no streams?|not found|aucun(?:e)? source)/i.test(text);
    if (obviousError) return false;

    return Boolean(
        stream.url || stream.externalUrl || stream.ytId || stream.yt_id ||
        stream.infoHash || stream.info_hash || (Array.isArray(stream.sources) && stream.sources.length > 0)
    );
}

function evaluateAvailability(totalStreams, checkedAddons, availabilityPrefs = null) {
    const minStreamCount = Math.max(1, Number.parseInt(availabilityPrefs?.minStreamCount, 10) || 1);
    const minAddonCount = Math.max(1, Number.parseInt(availabilityPrefs?.minAddonCount, 10) || 1);
    const matchedAddonCount = new Set((checkedAddons || []).map(addon => addon.id || addon.name)).size;

    return {
        available: totalStreams >= minStreamCount && matchedAddonCount >= minAddonCount,
        minStreamCount,
        minAddonCount,
        matchedAddonCount
    };
}


/**
 * Get installed addons for a Stremio user
 * @param {string} authKey - User's Stremio authentication key
 * @returns {Promise<Array>} List of installed addons with stream capability
 */
async function fetchInstalledAddons(authKey) {
    if (!authKey) {
        throw new Error('No Stremio auth key provided');
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
            response = await fetch(`${STREMIO_API_URL}/addonCollectionGet`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'AddonCollectionGet',
                    authKey: authKey
                })
            });
        } finally {
            clearTimeout(timeout);
        }

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
        const streamAddons = addons.filter(addon => hasStreamResource(addon.manifest));

        console.log(`[Stremio] Found ${streamAddons.length} stream-capable addons`);

        return streamAddons
            .filter(addon => addon.transportUrl)
            .map(addon => manifestToAddon(addon.manifest, addon.transportUrl, 'account'));

    } catch (error) {
        console.error('[Stremio] Failed to get addons:', error.message);
        throw error;
    }
}

async function getInstalledAddons(authKey) {
    if (!authKey) throw new Error('No Stremio auth key provided');
    const cached = getCached(accountAddonsCache, authKey);
    if (cached) return cached;

    // Cache the in-flight request too: simultaneous media additions share one API call.
    const pending = fetchInstalledAddons(authKey);
    setCached(accountAddonsCache, authKey, pending);
    try {
        const addons = await pending;
        // An empty list can be transient; do not persist it in the cache.
        if (addons.length) setCached(accountAddonsCache, authKey, addons);
        else accountAddonsCache.delete(authKey);
        return addons;
    } catch (error) {
        accountAddonsCache.delete(authKey);
        throw error;
    }
}

/** Probe real monitored seasons instead of assuming S01E01 exists. Bounded to three
 * episodes per addon, including S01E01 as a compatibility fallback. */
function buildStreamIds(media, imdbId) {
    if (media.type === 'movie') return [imdbId];

    const episodes = Array.isArray(media.checkEpisodes) ? media.checkEpisodes : [];
    const seasons = [...new Set(episodes
        .filter(ep => ep.monitored !== 0 && Number.isInteger(ep.season_number) && ep.season_number > 0)
        .map(ep => ep.season_number))].sort((a, b) => b - a);
    const ids = seasons.map(season => `${imdbId}:${season}:1`).slice(0, 2);
    const legacyId = `${imdbId}:1:1`;
    if (!ids.includes(legacyId)) ids.push(legacyId);
    return ids.slice(0, 3);
}

/**
 * Check if streams are available for a media item using user's addons
 * @param {Object} media - Media object with type, imdb_id, tmdb_id
 * @param {string|null} authKey - User's Stremio authentication key (optional when direct addons are configured)
 * @param {Array} selectedAddonIds - Optional array of account addon IDs to check
 * @param {Object} filterPrefs - User's filter preferences { languageTags: [], minResolution: null }
 * @param {Array} directManifestUrls - Direct Stremio addon manifest URLs
 * @param {Object} availabilityPrefs - Availability requirements { minStreamCount, minAddonCount }
 * @returns {Promise<Object>} Stream availability result
 */
async function checkStreamsWithUserAddons(
    media,
    authKey,
    selectedAddonIds = null,
    filterPrefs = null,
    directManifestUrls = [],
    availabilityPrefs = null
) {
    let imdbId = media.imdb_id;

    if (!imdbId && media.tmdb_id) {
        imdbId = await getImdbIdFromTmdb(media.type, media.tmdb_id);
    }

    if (!imdbId) {
        console.log(`[Stremio] No IMDB ID for: ${media.title}`);
        return {
            available: false,
            streamCount: 0,
            reason: 'No IMDB ID',
            conclusive: false,
            checkStatus: 'incomplete',
            lastChecked: new Date().toISOString()
        };
    }

    let accountAddons = [];
    let accountFailed = false;
    if (authKey) {
        try {
            accountAddons = await getInstalledAddons(authKey);
        } catch (error) {
            console.log(`[Stremio] Failed to get account addons: ${error.message}`);
            accountFailed = true;
        }
    }

    if (selectedAddonIds && selectedAddonIds.length > 0) {
        accountAddons = accountAddons.filter(addon => selectedAddonIds.includes(addon.id));
        console.log(`[Stremio] Filtering to ${accountAddons.length} selected account addons`);
    }

    const directDiagnostics = { failed: 0 };
    const directAddons = await getDirectAddons(directManifestUrls, directDiagnostics);
    let failedAddonCount = (accountFailed ? 1 : 0) + directDiagnostics.failed;
    const addons = [];
    const seenTransports = new Set();
    for (const addon of [...accountAddons, ...directAddons]) {
        if (!addon.transportUrl || seenTransports.has(addon.transportUrl)) continue;
        seenTransports.add(addon.transportUrl);
        addons.push(addon);
    }

    if (addons.length === 0) {
        return {
            available: false,
            streamCount: 0,
            reason: 'No stream addons available to check',
            conclusive: false,
            checkStatus: 'incomplete',
            addons: [],
            lastChecked: new Date().toISOString()
        };
    }

    let totalStreams = 0;
    const type = media.type === 'movie' ? 'movie' : 'series';
    const checkedAddons = [];
    let eligibleAddonCount = 0;
    let successfulAddonCount = 0;

    for (const addon of addons) {
        if (!addonSupportsType(addon, type)) {
            console.log(`[Stremio] Skipping ${addon.name} - doesn't support ${type}`);
            continue;
        }

        eligibleAddonCount++;
        // A series is considered available if a monitored season has a matching stream.
        // Only use the first matching episode per addon to avoid inflated totals.
        const episodeIds = buildStreamIds(media, imdbId);
        let addonSucceeded = false;
        let addonFailed = false;
        let streams = [];
        for (const streamId of episodeIds) {
            try {
                const streamUrl = buildResourceUrl(addon.transportUrl, 'stream', type, streamId);
                console.log(`[Stremio] Checking ${addon.name} (${addon.source || 'account'}): ${type}/${streamId}`);
                const response = await withStreamPermit(async () => {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        return await fetch(streamUrl, {
                            signal: controller.signal,
                            headers: { 'Accept': 'application/json' }
                        });
                    } finally {
                        clearTimeout(timeout);
                    }
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (!Array.isArray(data?.streams)) throw new Error('Invalid stream response');
                addonSucceeded = true;
                const candidates = data.streams.filter(isMeaningfulStream);
                let matched = candidates;
                if (filterPrefs?.languageTags?.length) {
                    matched = filterStreamsByLanguage(matched, filterPrefs.languageTags);
                }
                if (filterPrefs?.minResolution) {
                    matched = filterStreamsByResolution(matched, filterPrefs.minResolution);
                }
                if (matched.length < candidates.length) {
                    console.log(`[Stremio] ${addon.name}: ${candidates.length} → ${matched.length} after filters`);
                }
                if (matched.length > 0) {
                    streams = matched;
                    break;
                }
            } catch (error) {
                addonFailed = true;
                console.log(`[Stremio] Check failed for ${addon.name} (${streamId}): ${error.message}`);
            }
        }

        if (addonSucceeded) successfulAddonCount++;
        if (addonFailed) failedAddonCount++;
        const streamCount = streams.length;
        if (streamCount > 0) {
            totalStreams += streamCount;
                // Keep enough release details for Discord without retaining unlimited addon payloads.
                const streamDetails = streams.slice(0, 50).map(stream => {
                    let displayName = stream.behaviorHints?.filename ||
                        stream.description?.split('\n')[0]?.trim() ||
                        stream.title?.split('\n')[0]?.trim() ||
                        stream.name ||
                        'Unknown';

                    displayName = displayName.replace(/<[^>]*>/g, ' ').trim();
                    const searchText = getStreamSearchText(stream);

                    return {
                        name: displayName,
                        title: stream.title || '',
                        quality: extractQuality(searchText),
                        size: extractSize(searchText)
                    };
                });

            checkedAddons.push({
                id: addon.id,
                name: addon.name,
                source: addon.source || 'account',
                streamCount,
                streams: streamDetails
            });
        }
    }

    const availability = evaluateAvailability(totalStreams, checkedAddons, availabilityPrefs);
    // A negative result cannot be trusted when at least one configured addon failed.
    const conclusive = availability.available ||
        (eligibleAddonCount > 0 && successfulAddonCount === eligibleAddonCount && failedAddonCount === 0);
    const checkStatus = availability.available ? 'available' : (conclusive ? 'unavailable' : 'incomplete');
    console.log(
        `[Stremio] ${media.title}: ${totalStreams} streams from ${availability.matchedAddonCount} addons ` +
        `(required: ${availability.minStreamCount} streams / ${availability.minAddonCount} addons) => ${availability.available ? 'available' : 'unavailable'}`
    );

    return {
        available: availability.available,
        conclusive,
        checkStatus,
        reason: checkStatus === 'incomplete' ? 'One or more addons could not be verified' : undefined,
        streamCount: totalStreams,
        addonsCount: availability.matchedAddonCount,
        addons: checkedAddons,
        // Snapshot of the filters actually applied, even if settings change before Discord sends.
        appliedFilters: {
            languageTags: Array.isArray(filterPrefs?.languageTags) ? [...filterPrefs.languageTags] : [],
            minResolution: filterPrefs?.minResolution || null
        },
        requirements: {
            minStreamCount: availability.minStreamCount,
            minAddonCount: availability.minAddonCount
        },
        lastChecked: new Date().toISOString()
    };
}

/**
 * Filter streams by language tags - configurable per user
 * @param {Array} streams - Array of stream objects
 * @param {Array} languageTags - Array of allowed language tags (max 2), e.g. ['FRENCH', 'MULTI']
 * @returns {Array} Filtered streams
 */
function filterStreamsByLanguage(streams, languageTags = []) {
    // If no language tags configured, return all streams
    if (!languageTags || languageTags.length === 0) {
        return streams;
    }

    // Convert to uppercase for case-insensitive matching
    const allowedTags = languageTags.map(tag => tag.toUpperCase());

    const filtered = streams.filter(stream => {
        // Get stream name from best available source
        const streamName = getStreamSearchText(stream).toUpperCase();

        // Check if stream contains ANY of the allowed language tags
        const hasAllowedTag = allowedTags.some(tag => streamName.includes(tag));

        return hasAllowedTag;
    });

    if (filtered.length < streams.length) {
        console.log(`[Stremio] Language filter (${allowedTags.join(' OR ')}): ${streams.length} → ${filtered.length} streams`);
    }

    return filtered;
}

/**
 * Filter streams by minimum resolution
 * @param {Array} streams - Array of stream objects
 * @param {string} minResolution - Minimum resolution: '2160p', '1080p', '720p', or null for all
 * @returns {Array} Filtered streams
 */
function filterStreamsByResolution(streams, minResolution = null) {
    if (!minResolution) {
        return streams;
    }

    const resolutionOrder = { '2160P': 4, '4K': 4, 'UHD': 4, '1080P': 3, '720P': 2, '480P': 1 };
    const minLevel = resolutionOrder[minResolution.toUpperCase()] || 0;

    const filtered = streams.filter(stream => {
        const streamName = getStreamSearchText(stream).toUpperCase();

        // Check for resolution tags
        for (const [res, level] of Object.entries(resolutionOrder)) {
            if (streamName.includes(res) && level >= minLevel) {
                return true;
            }
        }

        // If no resolution detected, exclude (safe approach)
        return false;
    });

    if (filtered.length < streams.length) {
        console.log(`[Stremio] Resolution filter (${minResolution}+): ${streams.length} → ${filtered.length} streams`);
    }

    return filtered;
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
            response = await fetch(
                `${cinemata}/meta/${type === 'movie' ? 'movie' : 'series'}/tmdb:${tmdbId}.json`,
                { signal: controller.signal }
            );
        } finally {
            clearTimeout(timeout);
        }

        if (response.ok) {
            const data = await response.json();
            const candidate = data.meta?.imdb_id || data.meta?.id;
            return /^tt\d+$/i.test(candidate || '') ? candidate : null;
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

/**
 * Get library items (watch state) from Stremio for given IMDB IDs
 * @param {string} authKey - User's Stremio authentication key
 * @param {string[]} imdbIds - List of IMDB IDs to check
 * @returns {Promise<Object>} Map of imdbId -> { watched, timeWatched, duration }
 */
async function getLibraryItems(authKey, imdbIds) {
    if (!authKey || !imdbIds || imdbIds.length === 0) return {};

    try {
        const response = await fetch(`${STREMIO_API_URL}/datastoreGet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'DatastoreGet',
                authKey,
                collection: 'libraryItem',
                ids: imdbIds
            })
        });

        if (!response.ok) {
            console.error(`[Stremio] datastoreGet error: ${response.status}`);
            return {};
        }

        const data = await response.json();
        const items = data.result || [];

        const result = {};
        for (const item of items) {
            if (!item._id) continue;
            const state = item.state || {};
            result[item._id] = {
                watched: !!state.watched,
                timeWatched: state.timeWatched || 0,
                duration: state.duration || 0
            };
        }

        return result;
    } catch (error) {
        console.error('[Stremio] Failed to get library items:', error.message);
        return {};
    }
}

module.exports = {
    getInstalledAddons,
    getDirectAddons,
    checkStreamsWithUserAddons,
    getImdbIdFromTmdb,
    testAuthKey,
    loginWithCredentials,
    getLibraryItems,
    normalizeManifestUrl,
    buildResourceUrl,
    getStreamSearchText,
    filterStreamsByLanguage,
    filterStreamsByResolution,
    isMeaningfulStream,
    evaluateAvailability,
    buildStreamIds,
    addonSupportsType
};

