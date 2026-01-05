/**
 * Discord Notification Service
 * Sends notifications via Discord webhooks when media has no sources available
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
        embeds: [embed]
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
    let description = `**${lang.type}:** ${typeName}\n\n`;

    description += `**IMDB ID:** \`${imdbId}\`\n`;
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
    sendTestNotification
};
