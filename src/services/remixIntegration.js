/**
 * Optional, read-only availability bridge for Ether Remix.
 * A returned Stremio stream is a source observation, NOT proof of playback.
 */
const crypto = require('node:crypto');

const SCHEMA = 'seerrcatalog.availability.v1';
const STATUS_TTL_MS = 26 * 60 * 60 * 1000;
const RELEASE_TTL_MS = 30 * 60 * 1000;
const MAX_RELEASES = 50;

const setting = (db, key) => db.getSetting(`ether_remix_${key}`);
const enabled = db => setting(db, 'enabled') === 'true';

function validWebhookUrl(value) {
    if (!value) return '';
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error('Use an HTTP(S) URL without credentials or fragment');
    }
    return url.toString();
}

function timingSafeToken(provided, expected) {
    if (typeof provided !== 'string' || !expected) return false;
    const a = crypto.createHash('sha256').update(provided).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

function bearerAuthorized(db, header) {
    const match = /^Bearer ([^\s]+)$/i.exec(header || '');
    return enabled(db) && !!match && timingSafeToken(match[1], setting(db, 'token'));
}

function safeHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') return value;
    } catch (_) { /* Ignore invalid links. */ }
    return undefined;
}

/** Preserve only known Stremio stream fields needed by Remix, with strict bounds. */
function exportRelease(stream, addon, streamId, display) {
    if (!stream || typeof stream !== 'object') return null;
    const url = safeHttpUrl(stream.url);
    const externalUrl = safeHttpUrl(stream.externalUrl);
    const infoHash = typeof stream.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(stream.infoHash)
        ? stream.infoHash.toLowerCase() : undefined;
    const sources = Array.isArray(stream.sources)
        ? stream.sources.filter(s => typeof s === 'string' && s.length <= 512).slice(0, 30) : undefined;
    const hints = stream.behaviorHints || {};
    const requestHeaders = hints.proxyHeaders?.request;
    const headers = {};
    if (requestHeaders && typeof requestHeaders === 'object' && !Array.isArray(requestHeaders)) {
        for (const [name, value] of Object.entries(requestHeaders).slice(0, 16)) {
            if (/^[a-z0-9-]{1,64}$/i.test(name) && typeof value === 'string' && value.length <= 2048 && !/[\r\n\0]/.test(value)) {
                headers[name] = value;
            }
        }
    }
    if (!url && !externalUrl && !infoHash) return null;
    return {
        addonId: String(addon.id || '').slice(0, 256),
        addonName: String(addon.name || '').slice(0, 256),
        addonOrigin: safeHttpUrl(addon.transportUrl) ? new URL(addon.transportUrl).origin : '',
        streamId,
        name: String(display.name || '').slice(0, 500),
        title: String(display.title || '').slice(0, 500),
        quality: display.quality || null,
        size: display.size || null,
        stream: {
            ...(url && { url }),
            ...(externalUrl && { externalUrl }),
            ...(infoHash && { infoHash }),
            ...(sources?.length && { sources }),
            ...(Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0 && { fileIdx: stream.fileIdx }),
            ...(hints.filename && { behaviorHints: {
                filename: String(hints.filename).slice(0, 500),
                ...(Object.keys(headers).length && { proxyHeaders: { request: headers } })
            } }),
            ...(!hints.filename && Object.keys(headers).length && { behaviorHints: { proxyHeaders: { request: headers } } })
        }
    };
}

function snapshot(media, result, now = new Date()) {
    if (!result || result.conclusive !== true) return null;
    const checked = new Date(result.lastChecked || now).getTime();
    if (!Number.isFinite(checked)) return null;
    const raw = Array.isArray(result.remixReleases) ? result.remixReleases : [];
    return {
        schema: SCHEMA,
        media: {
            id: media.id,
            userId: media.user_id ?? null,
            type: media.type,
            imdbId: media.imdb_id || null,
            tmdbId: media.tmdb_id || null,
            title: media.title,
            year: media.year || null
        },
        available: !!result.available,
        availabilityConfirmed: !!result.available,
        checkStatus: result.available ? 'available' : 'unavailable',
        checkedAt: new Date(checked).toISOString(),
        expiresAt: new Date(checked + STATUS_TTL_MS).toISOString(),
        releasesExpireAt: new Date(checked + RELEASE_TTL_MS).toISOString(),
        streamCount: result.streamCount || 0,
        addonsCount: result.addonsCount || 0,
        appliedFilters: result.appliedFilters || null,
        requirements: result.requirements || null,
        releases: raw.slice(0, MAX_RELEASES)
    };
}

function activeSnapshot(data, now = Date.now()) {
    if (!data || (!data.availabilityConfirmed && Date.parse(data.expiresAt) <= now)) return null;
    if (!data.available) return { ...data, releases: [] };
    if (Date.parse(data.releasesExpireAt) <= now) {
        // Magnet info hashes are stable; expiring signed HTTP links and headers
        // must never be reused after their short validity window.
        const stable = (data.releases || []).filter(item => item.stream?.infoHash).map(item => ({
            ...item, stream: {
                infoHash: item.stream.infoHash,
                ...(Number.isInteger(item.stream.fileIdx) && { fileIdx: item.stream.fileIdx })
            }
        }));
        return { ...data, releases: stable };
    }
    return data;
}

function getSettings(db) {
    return {
        enabled: enabled(db),
        webhookUrl: setting(db, 'webhook_url') || '',
        tokenConfigured: !!setting(db, 'token'),
        feedUrlPath: '/api/integrations/remix/v1/availability'
    };
}

function updateSettings(db, updates) {
    // Validate every field before writing anything to the existing config.
    if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        throw new Error('enabled must be a boolean');
    }
    if (updates.enabled === true && !setting(db, 'token') && !updates.token) {
        throw new Error('Generate an integration token first');
    }
    if (updates.token !== undefined && updates.token !== '' &&
        (typeof updates.token !== 'string' || updates.token.length < 32 || updates.token.length > 256)) {
        throw new Error('Integration token must contain 32 to 256 characters');
    }
    const webhookUrl = updates.webhookUrl === undefined ? undefined : validWebhookUrl(updates.webhookUrl);
    if (updates.token !== undefined && updates.token !== '') {
        db.setSetting('ether_remix_token', updates.token);
    }
    if (webhookUrl !== undefined) {
        db.setSetting('ether_remix_webhook_url', webhookUrl);
    }
    if (updates.enabled !== undefined) {
        db.setSetting('ether_remix_enabled', String(updates.enabled));
        if (!updates.enabled) db.clearRemixSnapshots();
    }
    return getSettings(db);
}

function generateToken(db) {
    const token = crypto.randomBytes(32).toString('hex');
    db.setSetting('ether_remix_token', token);
    return token;
}

async function sendEvent(db, event, data, fetcher = global.fetch) {
    if (!enabled(db)) return false;
    const endpoint = setting(db, 'webhook_url');
    const token = setting(db, 'token');
    if (!endpoint || !token) return false;
    // Never delay the original availability check for an unavailable Remix instance.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            signal: controller.signal,
            redirect: 'error',
            body: JSON.stringify({ schema: SCHEMA, event, data })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    } catch (error) {
        // Snapshot polling lets Remix recover missed notifications.
        console.warn(`[Ether Remix] Delivery deferred: ${error.name || "Error"}`);
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

function recordSnapshot(db, media, result) {
    if (!enabled(db) || typeof db.saveRemixSnapshot !== 'function') return;
    const data = snapshot(media, result);
    if (!data) return;
    db.saveRemixSnapshot(media.id, data);
    // Fire-and-forget; callers have already committed the conclusive result.
    Promise.resolve().then(() => sendEvent(db, 'availability.updated', data)).catch(() => {});
}

function recordRemoval(db, media) {
    if (!enabled(db)) return;
    const data = { media: {
        id: media.id, userId: media.user_id ?? null, type: media.type,
        imdbId: media.imdb_id || null, tmdbId: media.tmdb_id || null
    } };
    Promise.resolve().then(() => sendEvent(db, 'media.removed', data)).catch(() => {});
}

// Backfill catalogue decisions, never renew the lifetime of playback links.
function ensureConfirmedSnapshots(db) {
    if (!enabled(db) || !db.db) return;
    const rows = db.db.prepare(`SELECT m.*, r.payload FROM media m LEFT JOIN remix_snapshots r ON r.media_id=m.id
        WHERE m.streams_available=1 AND (r.payload IS NULL OR COALESCE(json_extract(r.payload, '$.availabilityConfirmed'), 0) != 1)`).all();
    for (const media of rows) {
        const previous = media.payload ? JSON.parse(media.payload) : null;
        if (previous?.availabilityConfirmed && previous.available) continue;
        const value = previous?.available ? { ...previous, availabilityConfirmed: true } : snapshot(media, {
            available: true, conclusive: true, streamCount: media.stream_count,
            lastChecked: media.last_stream_check || media.added_at,
            appliedFilters: media.stream_filters_detail ? JSON.parse(media.stream_filters_detail) : null
        });
        if (value) db.saveRemixSnapshot(media.id, value);
    }
}

module.exports = {
    ensureConfirmedSnapshots,
    SCHEMA, exportRelease, snapshot, activeSnapshot, bearerAuthorized,
    getSettings, updateSettings, generateToken, recordSnapshot, recordRemoval, sendEvent
};
