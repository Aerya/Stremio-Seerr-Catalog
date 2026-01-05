const express = require('express');
const path = require('path');
const db = require('../db');
const tmdb = require('../services/tmdb');

const router = express.Router();

// Serve static files with no-cache headers to prevent proxy caching
router.use(express.static(path.join(__dirname, '../../public'), {
    setHeaders: (res, filePath) => {
        // Prevent caching of HTML and JS files
        if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// API: Get catalog stats
router.get('/api/stats', (req, res) => {
    const { userId } = req.query;
    const counts = userId ? db.countMediaByUser(parseInt(userId)) : db.countMedia();
    res.json(counts);
});

// API: Get all media with filters
router.get('/api/media', (req, res) => {
    const { type, watched, available, userId } = req.query;

    const filters = {};
    if (type) filters.type = type;
    if (watched !== undefined) filters.watched = watched === 'true';
    if (available !== undefined) filters.available = available === 'true';
    if (userId) filters.userId = parseInt(userId);

    const media = db.getFilteredMedia(filters);
    res.json(media);
});



// API: Mark as watched
router.post('/api/media/:id/watched', (req, res) => {
    const id = parseInt(req.params.id);
    const { deleteAfter } = req.body || {};

    const media = db.getMediaById(id);
    if (!media) return res.status(404).json({ error: 'Not found' });

    const result = db.markAsWatched(id, deleteAfter);
    res.json(result || { success: true, deleted: deleteAfter });
});

// API: Mark as unwatched
router.delete('/api/media/:id/watched', (req, res) => {
    const id = parseInt(req.params.id);
    const media = db.getMediaById(id);
    if (!media) return res.status(404).json({ error: 'Not found' });

    const result = db.markAsUnwatched(id);
    res.json(result);
});

// API: Check streams for media
router.post('/api/media/:id/check-streams', async (req, res) => {
    const media = db.getMediaById(parseInt(req.params.id));
    if (!media) return res.status(404).json({ error: 'Not found' });

    try {
        const { checkStreamsAvailable } = require('../services/streamChecker');
        const result = await checkStreamsAvailable(media, db);
        db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
        res.json({ ...result, title: media.title });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Delete media
router.delete('/api/media/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const media = db.getMediaById(id);
    if (!media) return res.status(404).json({ error: 'Not found' });

    db.deleteMedia(id);
    console.log(`[WebUI] Media deleted: ${id} - ${media.title}`);
    res.json({ success: true, deleted: id });
});

// API: Check all streams
router.post('/api/check-all-streams', async (req, res) => {
    try {
        const { recheckUnavailableMedia } = require('../services/streamChecker');
        recheckUnavailableMedia(db).catch(console.error);
        res.json({ message: 'Started' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Get users
router.get('/api/users', (req, res) => {
    res.json(db.getAllUsers());
});

// API: Get/Set settings
router.get('/api/settings/:key', (req, res) => {
    const value = db.getSetting(req.params.key);
    res.json({ key: req.params.key, value });
});

router.put('/api/settings/:key', (req, res) => {
    const { value } = req.body;
    db.setSetting(req.params.key, value);
    res.json({ success: true });
});

router.get('/api/settings', (req, res) => {
    res.json(db.getAllSettings());
});

// ============== Discord Webhook API ==============

const discord = require('../services/discord');

// Get all webhooks (masked for security)
router.get('/api/discord/webhooks', (req, res) => {
    const webhooks = discord.getWebhookUrls();
    // Mask webhook URLs for security (show only last 8 chars)
    const masked = webhooks.map(url => {
        const lastPart = url.split('/').pop();
        return {
            id: lastPart.substring(0, 8),
            masked: `...${lastPart.substring(lastPart.length - 8)}`,
            full: url // Only for deletion reference
        };
    });
    res.json(masked);
});

// Add webhook
router.post('/api/discord/webhooks', (req, res) => {
    const { url } = req.body;
    try {
        discord.addWebhookUrl(url);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Remove webhook
router.delete('/api/discord/webhooks', (req, res) => {
    const { url } = req.body;
    try {
        discord.removeWebhookUrl(url);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Test webhook
router.post('/api/discord/test', async (req, res) => {
    try {
        await discord.sendTestNotification();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get/Set notification settings
router.get('/api/discord/settings', (req, res) => {
    res.json({
        enabled: discord.isNotificationsEnabled(),
        language: discord.getNotificationLanguage()
    });
});

router.put('/api/discord/settings', (req, res) => {
    const { enabled, language } = req.body;
    if (enabled !== undefined) {
        discord.setNotificationsEnabled(enabled);
    }
    if (language !== undefined) {
        discord.setNotificationLanguage(language);
    }
    res.json({ success: true });
});

// API: Config status
router.get('/api/config', (req, res) => {
    const tmdbKey = tmdb.getApiKey(db);
    res.json({
        tmdbConfigured: tmdb.isConfigured(db),
        tmdbKey: tmdbKey ? '•'.repeat(Math.min(tmdbKey.length, 20)) : null,
        apiKey: process.env.API_KEY || 'seerrcatalog-api-key',
        version: '1.4.0'
    });
});

// Login page
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/login.html'));
});

// Home
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

module.exports = router;
