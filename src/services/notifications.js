/** Additional notification transports. Endpoint/targets are private settings. */
const db = require('../db');
const discord = require('./discord');

function settings() {
    return {
        enabled: db.getSetting('apprise_enabled') === 'true',
        endpoint: db.getSetting('apprise_endpoint') || '',
        urlsConfigured: !!db.getSetting('apprise_urls'),
        mention: db.getSetting('review_mention') || ''
    };
}
function save(values) {
    if (values.enabled !== undefined && typeof values.enabled !== 'boolean') throw new Error('enabled must be boolean');
    if (values.endpoint) {
        const url = new URL(values.endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('URL HTTP(S) sans identifiants attendue');
    }
    if (values.mention !== undefined && !/^(?:\d{17,20})?$/.test(values.mention)) throw new Error('Identifiant Discord numérique attendu (17 à 20 chiffres)');
    if (values.urls !== undefined && (typeof values.urls !== 'string' || values.urls.length > 16000)) throw new Error('Destinations invalides');
    if (values.enabled && !(values.endpoint || settings().endpoint)) throw new Error('Adresse Apprise requise');
    for (const key of ['enabled', 'endpoint', 'urls']) if (values[key] !== undefined) db.setSetting(`apprise_${key}`, String(values[key]));
    if (values.mention !== undefined) db.setSetting('review_mention', values.mention);
}
async function sendApprise(title, body, type = 'info') {
    const config = settings();
    if (!config.enabled || !config.endpoint) return false;
    const urls = db.getSetting('apprise_urls');
    const response = await fetch(config.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, type, format: 'text', ...(urls ? { urls } : {}) })
    });
    if (!response.ok) throw new Error(`Apprise HTTP ${response.status}`);
    return true;
}
async function sendReviewNotification(media) {
    const config = settings();
    const mention = config.mention ? `<@${config.mention}> ` : '';
    const title = 'Une release : validation à effectuer';
    const body = `${mention}${media.title} : une seule release après les contrôles J+1 et J+3. Vous pouvez la valider dans SeerrCatalog. La recherche continue chaque jour.`;
    const outcomes = await Promise.allSettled([
        discord.isNotificationsEnabled() ? discord.sendReviewNotification(title, body, config.mention) : false,
        sendApprise(title, body, 'warning')
    ]);
    // No configured destination (or failed delivery): retry at a later search.
    return outcomes.some(o => o.status === 'fulfilled' && o.value === true);
}
module.exports = { settings, save, sendApprise, sendReviewNotification };
