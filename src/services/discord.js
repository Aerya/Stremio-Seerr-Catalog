/**
 * Discord Notification Service
 * Sends lifecycle notifications via Discord webhooks
 */

const db = require('../db');

// Settings keys
const WEBHOOKS_SETTING_KEY = 'discord_webhooks';
const NOTIFICATIONS_ENABLED_KEY = 'discord_notifications_enabled';
const NOTIFICATIONS_LANGUAGE_KEY = 'discord_notifications_language';

// Translations for Discord notifications
const translations = {
    en: {
        noSourceTitle: '⚠️ No Source Found',
        sourcesFoundTitle: '✅ Sources Found',
        removedTitle: '🗑️ Content Removed',
        streams: 'Streams',
        addons: 'Addons',
        removalReason: 'Reason',
        removedWatched: 'Watched (automatic cleanup)',
        removedManual: 'Manual deletion',
        removedExternal: 'Removal requested via Radarr/Sonarr',
        testTitle: '✅ Test Notification',
        testDescription: 'Discord webhook is working correctly!',
        type: 'Type',
        media: 'Media',
        movie: 'Movie',
        series: 'Series',
        filters: 'Search Filters',
        languages: 'Languages',
        resolution: 'Min Resolution',
        noFilters: 'None'
    },
    fr: {
        noSourceTitle: '⚠️ Aucune Source Trouvée',
        sourcesFoundTitle: '✅ Sources trouvées',
        removedTitle: '🗑️ Contenu retiré',
        streams: 'Sources',
        addons: 'Addons',
        removalReason: 'Motif',
        removedWatched: 'Visionné (nettoyage automatique)',
        removedManual: 'Suppression manuelle',
        removedExternal: 'Retrait demandé via Radarr/Sonarr',
        testTitle: '✅ Notification de Test',
        testDescription: 'Le webhook Discord fonctionne correctement !',
        type: 'Type',
        media: 'Média',
        movie: 'Film',
        series: 'Série',
        filters: 'Filtres de recherche',
        languages: 'Langues',
        resolution: 'Résolution min',
        noFilters: 'Aucun'
    }
};

/**
 * Get all configured webhook URLs
 * @returns {string[]} Array of webhook URLs
 */
function getWebhookUrls() {
    const json = db.getSetting(WEBHOOKS_SETTING_KEY);
    if (!json) return [];
    try {
        return JSON.parse(json);
    } catch (e) {
        console.error('[Discord] Failed to parse webhooks:', e.message);
        return [];
    }
}

/**
 * Add a webhook URL
 * @param {string} url - Discord webhook URL
 * @returns {boolean} Success
 */
function addWebhookUrl(url) {
    if (!url || !url.includes('discord.com/api/webhooks/')) {
        throw new Error('Invalid Discord webhook URL');
    }

    const webhooks = getWebhookUrls();
    if (webhooks.includes(url)) {
        throw new Error('Webhook already exists');
    }

    webhooks.push(url);
    db.setSetting(WEBHOOKS_SETTING_KEY, JSON.stringify(webhooks));
    console.log('[Discord] Webhook added');
    return true;
}

/**
 * Remove a webhook URL
 * @param {string} url - Discord webhook URL to remove
 * @returns {boolean} Success
 */
function removeWebhookUrl(url) {
    const webhooks = getWebhookUrls();
    const index = webhooks.indexOf(url);
    if (index === -1) {
        throw new Error('Webhook not found');
    }

    webhooks.splice(index, 1);
    db.setSetting(WEBHOOKS_SETTING_KEY, JSON.stringify(webhooks));
    console.log('[Discord] Webhook removed');
    return true;
}

/**
 * Check if notifications are enabled
 * @returns {boolean}
 */
function isNotificationsEnabled() {
    const enabled = db.getSetting(NOTIFICATIONS_ENABLED_KEY);
    return enabled !== 'false'; // Default to enabled
}

/**
 * Set notifications enabled state
 * @param {boolean} enabled
 */
function setNotificationsEnabled(enabled) {
    db.setSetting(NOTIFICATIONS_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * Get notification language
 * @returns {string} 'en' or 'fr'
 */
function getNotificationLanguage() {
    const lang = db.getSetting(NOTIFICATIONS_LANGUAGE_KEY);
    return lang === 'fr' ? 'fr' : 'en'; // Default to English
}

/**
 * Set notification language
 * @param {string} lang - 'en' or 'fr'
 */
function setNotificationLanguage(lang) {
    db.setSetting(NOTIFICATIONS_LANGUAGE_KEY, lang === 'fr' ? 'fr' : 'en');
}

/**
 * Get translation for current language
 * @returns {Object}
 */
function t() {
    return translations[getNotificationLanguage()];
}

/**
 * Send notification to all configured webhooks
 * @param {Object} embed - Discord embed object
 */
async function sendToAllWebhooks(embed) {
    const webhooks = getWebhookUrls();
    if (webhooks.length === 0) {
        console.log('[Discord] No webhooks configured, skipping notification');
        return;
    }

    const payload = {
        embeds: [embed],
        allowed_mentions: { parse: [] }
    };

    for (const webhookUrl of webhooks) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error(`[Discord] Webhook failed (${response.status}):`, await response.text());
            } else {
                console.log('[Discord] Notification sent successfully');
            }
        } catch (e) {
            console.error('[Discord] Failed to send notification:', e.message);
        }
    }
}

/**
 * Send notification when no source is found for a media
 * @param {Object} media - Media object
 * @param {Object} filterPrefs - Optional filter preferences used during search
 */
async function sendNoSourceNotification(media, filterPrefs = null) {
    if (!isNotificationsEnabled()) {
        console.log('[Discord] Notifications disabled, skipping');
        return;
    }

    const lang = t();
    const isMovie = media.type === 'movie';
    const typeName = isMovie ? lang.movie : lang.series;

    // Use Radarr/Sonarr icons from CDN (same as WebUI)
    const iconUrl = isMovie
        ? 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/radarr.webp'
        : 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/sonarr.webp';

    // Build IMDB link
    const imdbId = media.imdb_id || 'N/A';
    const imdbLink = media.imdb_id
        ? `https://www.imdb.com/title/${media.imdb_id}`
        : null;

    // Build TMDB link
    const tmdbId = media.tmdb_id || 'N/A';
    const tmdbType = isMovie ? 'movie' : 'tv';
    const tmdbLink = media.tmdb_id
        ? `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}`
        : null;

    // Build description with IDs and links
    let description = `**IMDB ID:** \`${imdbId}\`\n`;
    if (imdbLink) {
        description += `${imdbLink}\n`;
    }
    description += '\n';

    description += `**TMDB ID:** \`${tmdbId}\`\n`;
    if (tmdbLink) {
        description += `${tmdbLink}\n`;
    }

    // Build filters field
    let filtersValue = lang.noFilters;
    if (filterPrefs) {
        const parts = [];
        if (filterPrefs.languageTags && filterPrefs.languageTags.length > 0) {
            parts.push(`**${lang.languages}:** ${filterPrefs.languageTags.join(', ')}`);
        }
        if (filterPrefs.minResolution) {
            parts.push(`**${lang.resolution}:** ${filterPrefs.minResolution}`);
        }
        if (parts.length > 0) {
            filtersValue = parts.join('\n');
        }
    }

    const embed = {
        title: lang.noSourceTitle,
        description: description,
        color: 0xFFA500, // Orange
        author: {
            name: typeName,
            icon_url: iconUrl
        },
        fields: [
            {
                name: lang.media,
                value: `**${media.title}** (${media.year || 'N/A'})`,
                inline: false
            },
            {
                name: lang.filters,
                value: filtersValue,
                inline: false
            }
        ],
        thumbnail: media.poster ? { url: media.poster } : null,
        timestamp: new Date().toISOString()
        // No footer - removed for privacy (no server URL exposed)
    };

    await sendToAllWebhooks(embed);
}

/** Media links are for informational purposes and do not expose instance URLs. */
function mediaReferences(media) {
    const imdb = /^tt\d+$/.test(String(media.imdb_id || ''))
        ? `https://www.imdb.com/title/${media.imdb_id}` : null;
    const tmdb = /^\d+$/.test(String(media.tmdb_id || ''))
        ? `https://www.themoviedb.org/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdb_id}` : null;
    return [imdb, tmdb].filter(Boolean).join('\n');
}

function mediaLifecycleEmbed(media, title, color, extraFields = []) {
    const lang = t();
    const value = `**${String(media.title || '').slice(0, 850)}** (${media.year || 'N/A'})`;
    const icon = media.type === 'movie' ? 'radarr' : 'sonarr';
    const poster = typeof media.poster === 'string' && /^https:\/\//.test(media.poster)
        ? { url: media.poster } : undefined;
    return {
        title,
        color,
        author: {
            name: media.type === 'movie' ? lang.movie : lang.series,
            icon_url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/${icon}.webp`
        },
        fields: [{ name: lang.media, value, inline: false }, ...extraFields],
        ...(poster ? { thumbnail: poster } : {}),
        description: mediaReferences(media) || undefined,
        timestamp: new Date().toISOString()
    };
}

/** Send only for a confirmed transition from unavailable to available. */
async function sendSourcesFoundNotification(media, result) {
    if (!isNotificationsEnabled()) return;
    const lang = t();
    const addons = (Array.isArray(result.addons) ? result.addons : [])
        .filter(addon => Array.isArray(addon.streams) && addon.streams.length > 0)
        .map(addon => String(addon.name || addon.id || '').slice(0, 80))
        .filter(Boolean).slice(0, 8);
    const fields = [
        { name: lang.streams, value: String(result.streamCount || 0), inline: true }
    ];
    if (addons.length) {
        fields.push({ name: lang.addons, value: addons.join(', ').slice(0, 1000), inline: false });
    }
    await sendToAllWebhooks(mediaLifecycleEmbed(media, lang.sourcesFoundTitle, 0x24B47E, fields));
}

/** Reasons are explicit; a watched mark without removal does not generate an alert. */
async function sendMediaRemovedNotification(media, reason) {
    if (!isNotificationsEnabled()) return;
    const lang = t();
    const reasonNames = {
        watched: lang.removedWatched,
        manual: lang.removedManual,
        external: lang.removedExternal
    };
    const embed = mediaLifecycleEmbed(media, lang.removedTitle, 0xE85D61, [
        { name: lang.removalReason, value: reasonNames[reason] || lang.removedManual, inline: false }
    ]);
    await sendToAllWebhooks(embed);
}

/**
 * Send a test notification
 */
async function sendTestNotification() {
    const lang = t();
    const embed = {
        title: lang.testTitle,
        description: lang.testDescription,
        color: 0x00FF00, // Green
        timestamp: new Date().toISOString()
        // No footer - removed for privacy
    };

    await sendToAllWebhooks(embed);
}

module.exports = {
    getWebhookUrls,
    addWebhookUrl,
    removeWebhookUrl,
    isNotificationsEnabled,
    setNotificationsEnabled,
    getNotificationLanguage,
    setNotificationLanguage,
    sendNoSourceNotification,
    sendSourcesFoundNotification,
    sendMediaRemovedNotification,
    sendTestNotification
};
