const express = require('express');
const db = require('../db');

const router = express.Router();

// Get all users
router.get('/', (req, res) => {
    const users = db.getAllUsers();
    res.json(users);
});

// Create user
router.post('/', (req, res) => {
    const { username, password, displayName, isAdmin } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if username already exists
    const existing = db.getUserByUsername(username);
    if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    try {
        const user = db.createUser(username, password, displayName, isAdmin);
        res.status(201).json({
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get user by ID
router.get('/:id', (req, res) => {
    const user = db.getUserById(parseInt(req.params.id));

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
        created_at: user.created_at
    });
});

// Update user
router.put('/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const { displayName, isAdmin } = req.body;

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.updateUser(id, displayName || user.display_name, isAdmin !== undefined ? isAdmin : user.is_admin);
    res.json({ success: true });
});

// Change password
router.put('/:id/password', (req, res) => {
    const id = parseInt(req.params.id);
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.updateUserPassword(id, password);
    res.json({ success: true });
});

// Delete user
router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id);

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    try {
        db.deleteUser(id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Get user's media catalog
router.get('/:id/media', (req, res) => {
    const userId = parseInt(req.params.id);
    const { type, watched, available } = req.query;

    const filters = { userId };
    if (type) filters.type = type;
    if (watched !== undefined) filters.watched = watched === 'true';
    if (available !== undefined) filters.available = available === 'true';

    const media = db.getFilteredMedia(filters);
    res.json(media);
});

// Get user's stats
router.get('/:id/stats', (req, res) => {
    const userId = parseInt(req.params.id);
    const stats = db.countMediaByUser(userId);
    res.json(stats);
});

// Set user's Stremio auth key
router.put('/:id/stremio', async (req, res) => {
    const id = parseInt(req.params.id);
    const { authKey } = req.body;

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!authKey) {
        return res.status(400).json({ error: 'authKey is required' });
    }

    // Test the auth key before saving
    try {
        const { testAuthKey } = require('../services/stremio');
        const result = await testAuthKey(authKey);

        if (!result.valid) {
            return res.status(400).json({
                error: 'Invalid Stremio auth key',
                details: result.error
            });
        }

        db.updateUserStremioKey(id, authKey);
        res.json({
            success: true,
            addonsCount: result.addonsCount,
            addons: result.addons
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get user's Stremio addons (requires auth key to be set)
router.get('/:id/stremio/addons', async (req, res) => {
    const id = parseInt(req.params.id);

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stremio_auth_key) {
        return res.status(400).json({ error: 'No Stremio auth key configured' });
    }

    try {
        const { getInstalledAddons } = require('../services/stremio');
        const addons = await getInstalledAddons(user.stremio_auth_key);
        res.json({ addons });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Check if user has Stremio configured
router.get('/:id/stremio', (req, res) => {
    const id = parseInt(req.params.id);

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        configured: !!user.stremio_auth_key,
        hasKey: !!user.stremio_auth_key
    });
});

// Login to Stremio with email/password and save auth key
router.post('/:id/stremio/login', async (req, res) => {
    const id = parseInt(req.params.id);
    const { email, password } = req.body;

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const { loginWithCredentials } = require('../services/stremio');
        const result = await loginWithCredentials(email, password);

        if (!result.success) {
            return res.status(401).json({
                error: 'Stremio login failed',
                details: result.error
            });
        }

        // Save the auth key
        db.updateUserStremioKey(id, result.authKey);

        res.json({
            success: true,
            email: result.email,
            addonsCount: result.addonsCount,
            addons: result.addons
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Disconnect Stremio (remove auth key)
router.delete('/:id/stremio', (req, res) => {
    const id = parseInt(req.params.id);

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.updateUserStremioKey(id, null);
    res.json({ success: true });
});

// Save selected addons for stream checking
router.put('/:id/stremio/selected-addons', (req, res) => {
    const id = parseInt(req.params.id);
    const { addonIds } = req.body;  // Array of addon IDs to use

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!Array.isArray(addonIds)) {
        return res.status(400).json({ error: 'addonIds must be an array' });
    }

    db.setSetting(`stremio_selected_addons_${id}`, JSON.stringify(addonIds));
    res.json({ success: true, selectedAddons: addonIds });
});

// Get selected addons for stream checking
router.get('/:id/stremio/selected-addons', (req, res) => {
    const id = parseInt(req.params.id);

    const user = db.getUserById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const saved = db.getSetting(`stremio_selected_addons_${id}`);
    const selectedAddons = saved ? JSON.parse(saved) : [];
    res.json({ selectedAddons });
});

module.exports = router;


