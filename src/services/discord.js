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
        noFilters: 'None',
        releases: 'Available releases',
        moreReleases: 'Other releases not displayed'
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
        noFilters: 'Aucun',
        releases: 'Releases disponibles',
        moreReleases: 'Autres releases non affichées'
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

/**
 * Show the filters used for this exact check, not a possibly modified later setting.
 * Older callers without a snapshot still use the media owner's saved preferences.
 */
function filtersForFoundNotification(media, result) {
    if (result?.appliedFilters && typeof result.appliedFilters === 'object') {
        return result.appliedFilters;
    }
    if (media.user_id == null) return null;
    let languageTags = [];
    try {
        const parsed = JSON.parse(db.getSetting(`stream_filter_languages_${media.user_id}`) || '[]');
        if (Array.isArray(parsed)) languageTags = parsed;
    } catch { /* Malformed preferences are treated as unset. */ }
    return {
        languageTags,
        minResolution: db.getSetting(`stream_filter_resolution_${media.user_id}`) || null
    };
}

function formatSearchFilters(lang, prefs) {
    const parts = [];
    if (Array.isArray(prefs?.languageTags) && prefs.languageTags.length) {
        parts.push(`**${lang.languages}:** ${prefs.languageTags.map(String).join(', ')}`);
    }
    if (prefs?.minResolution) parts.push(`**${lang.resolution}:** ${String(prefs.minResolution)}`);
    return (parts.join('\n') || lang.noFilters).slice(0, 1024);
}

/** Addon-provided strings are untrusted; keep filenames readable and prevent formatting/pings. */
function cleanDiscordText(value, maxLength = 260) {
    const cleaned = String(value ?? '')
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/@/g, '＠')
        .replace(/[`]/g, "'")
        .replace(/[\\*_~|]/g, '\\$&')
        .trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function releaseLine(stream) {
    const quality = cleanDiscordText(stream.quality, 32);
    const size = cleanDiscordText(stream.size, 32);
    const name = cleanDiscordText(stream.name || stream.title || 'Unknown', 280);
    const meta = [quality, size].filter(Boolean).join(' • ');
    return `• ${meta ? `${meta} — ` : ''}\`${name}\``;
}

/**
 * Discord limits: 25 fields, 1024 characters/field, and 6000 total per embed.
 * Preserve one webhook message per event, and explicitly report undisplayed releases.
 */
function appendReleaseFields(embed, addons, streamCount, lang) {
    const maxEmbedChars = 5600; // Room for truncation summary and Discord's 6000 limit.
    const maxFieldValue = 960;
    const maxFieldsBeforeSummary = 24;
    let used = (embed.title?.length || 0) + (embed.description?.length || 0) +
        (embed.author?.name?.length || 0) +
        embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    let shown = 0;
    let stop = false;

    for (const addon of addons) {
        const streams = Array.isArray(addon.streams) ? addon.streams : [];
        if (!streams.length) continue;
        const addonName = cleanDiscordText(addon.name || addon.id || 'Addon', 90);
        const firstName = `${lang.releases} — ${addonName}`.slice(0, 256);
        let field = null;
        let chunk = 0;

        for (const stream of streams) {
            const line = releaseLine(stream);
            const needsNewField = !field || field.value.length + 1 + line.length > maxFieldValue;
            if (needsNewField) {
                const name = chunk === 0 ? firstName : `${firstName} (${chunk + 1})`.slice(0, 256);
                if (embed.fields.length >= maxFieldsBeforeSummary || used + name.length + line.length > maxEmbedChars) {
                    stop = true;
                    break;
                }
                field = { name, value: '', inline: false };
                embed.fields.push(field);
                used += name.length;
                chunk++;
            } else if (used + line.length + 1 > maxEmbedChars) {
                stop = true;
                break;
            }
            field.value += (field.value ? '\n' : '') + line;
            used += line.length + (shown && field.value !== line ? 1 : 0);
            shown++;
        }
        if (stop) break;
    }

    const counted = addons.reduce((sum, addon) => {
        const listed = Array.isArray(addon.streams) ? addon.streams.length : 0;
        const reported = Number(addon.streamCount);
        return sum + (Number.isFinite(reported) && reported > listed ? reported : listed);
    }, 0);
    const omitted = Math.max(counted, Number(streamCount) || 0) - shown;
    if (omitted > 0 && embed.fields.length < 25) {
        const value = `+${omitted}`;
        if (used + lang.moreReleases.length + value.length < 6000) {
            embed.fields.push({ name: lang.moreReleases, value, inline: false });
        }
    }
}

/** Send only for a confirmed transition from unavailable to available. */
async function sendSourcesFoundNotification(media, result) {
    if (!isNotificationsEnabled()) return;
    const lang = t();
    const addonsWithStreams = (Array.isArray(result.addons) ? result.addons : [])
        .filter(addon => Array.isArray(addon.streams) && addon.streams.length > 0);
    const addonNames = addonsWithStreams
        .map(addon => cleanDiscordText(addon.name || addon.id || '', 80))
        .filter(Boolean);
    const fields = [
        { name: lang.filters, value: formatSearchFilters(lang, filtersForFoundNotification(media, result)), inline: false },
        { name: lang.streams, value: String(result.streamCount || 0), inline: true }
    ];
    if (addonNames.length) {
        fields.push({ name: lang.addons, value: addonNames.join(', ').slice(0, 1000), inline: false });
    }
    const embed = mediaLifecycleEmbed(media, lang.sourcesFoundTitle, 0x24B47E, fields);
    appendReleaseFields(embed, addonsWithStreams, result.streamCount, lang);
    await sendToAllWebhooks(embed);
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
