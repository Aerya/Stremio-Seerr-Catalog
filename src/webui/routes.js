const express = require('express');
const path = require('path');
const db = require('../db');
const tmdb = require('../services/tmdb');

const router = express.Router();

// Serve static files
router.use(express.static(path.join(__dirname, '../../public')));

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

// API: Config status
router.get('/api/config', (req, res) => {
    const tmdbKey = db.getSetting('tmdb_api_key');
    res.json({
        tmdbConfigured: tmdb.isConfigured(db),
        tmdbKey: tmdbKey ? '•'.repeat(Math.min(tmdbKey.length, 20)) : null,
        version: '1.3.0'
    });
});

// Home
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

module.exports = router;
