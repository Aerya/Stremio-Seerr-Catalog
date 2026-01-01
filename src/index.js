const express = require('express');
const cookieParser = require('cookie-parser');
const { getRouter } = require('stremio-addon-sdk');

const { getManifest } = require('./addon/manifest');
const { catalogHandler, metaHandler } = require('./addon/handlers');
const radarrRoutes = require('./radarr/routes');
const sonarrRoutes = require('./sonarr/routes');
const jellyfinRoutes = require('./jellyfin/routes');
const webuiRoutes = require('./webui/routes');
const usersRoutes = require('./api/users');
const db = require('./db');
const { startBackgroundChecker } = require('./services/streamChecker');
const { configureSession, requireAuth, handleLogin, handleLogout, getCurrentUser } = require('./auth/session');

// Environment configuration
const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '0.0.0.0';
const ADDON_USER = process.env.ADDON_USER || 'admin';
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || 'changeme';
const API_KEY = process.env.API_KEY || 'seerrcatalog-api-key';
const BASE_URL = process.env.BASE_URL || null;

// Initialize Express
const app = express();
// Trust ALL proxies - important for HTTPS detection behind reverse proxies
app.set('trust proxy', true);
app.use(express.json());
app.use(cookieParser());

// Configure session
configureSession(app);

// CORS for Stremio and Jellyseerr
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Api-Key, X-Emby-Authorization, Authorization, X-Emby-Token, X-Emby-Device-Id, X-Emby-Device-Name');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Health check endpoint (no auth)
app.get('/health', (req, res) => {
    const stats = db.countMedia();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        stats
    });
});

// API Key authentication middleware for Radarr/Sonarr
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apikey || req.query.apiKey;

    if (apiKey === API_KEY) {
        return next();
    }

    res.status(401).json({ error: 'Invalid API key' });
};

// Radarr API (API key auth) - Global (assigns to admin user)
app.use('/radarr', apiKeyAuth, radarrRoutes);

// Sonarr API (API key auth) - Global (assigns to admin user)
app.use('/sonarr', apiKeyAuth, sonarrRoutes);

// User-specific Radarr/Sonarr routes - media is assigned to the specific user
app.use('/user/:userId/radarr', apiKeyAuth, (req, res, next) => {
    req.seerrcatalogUserId = parseInt(req.params.userId);
    next();
}, radarrRoutes);

app.use('/user/:userId/sonarr', apiKeyAuth, (req, res, next) => {
    req.seerrcatalogUserId = parseInt(req.params.userId);
    next();
}, sonarrRoutes);

// Jellyfin API (emulated for Jellyseerr)
app.use('/jellyfin', jellyfinRoutes);
// Also mount on root for compatibility (Jellyseerr may call /Users directly)
app.use('/', (req, res, next) => {
    // Route Jellyfin-specific paths
    if (req.path.startsWith('/System') ||
        req.path.startsWith('/Users') ||
        req.path.startsWith('/Library') ||
        req.path.startsWith('/Branding') ||
        req.path.startsWith('/Plugins')) {
        return jellyfinRoutes(req, res, next);
    }
    next();
});

// Stremio Addon (no auth for compatibility)
const manifest = getManifest(BASE_URL);

// Manual Stremio routes for more control
app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/catalog/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const extra = {};

        // Parse extra parameters from query string
        if (req.query.skip) extra.skip = req.query.skip;
        if (req.query.genre) extra.genre = req.query.genre;
        if (req.query.search) extra.search = req.query.search;

        const result = await catalogHandler({ type, id, extra });
        res.json(result);
    } catch (e) {
        console.error('Catalog error:', e);
        res.json({ metas: [] });
    }
});

app.get('/catalog/:type/:id/:extra.json', async (req, res) => {
    try {
        const { type, id, extra: extraStr } = req.params;
        const extra = {};

        // Parse extra string (format: "skip=20&genre=Action")
        if (extraStr) {
            extraStr.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value) extra[key] = decodeURIComponent(value);
            });
        }

        const result = await catalogHandler({ type, id, extra });
        res.json(result);
    } catch (e) {
        console.error('Catalog error:', e);
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const result = await metaHandler({ type, id });
        res.json(result);
    } catch (e) {
        console.error('Meta error:', e);
        res.json({ meta: null });
    }
});

// === USER-SPECIFIC STREMIO ADDON ROUTES ===
// Each user gets their own manifest and catalog filtered by their user_id

app.get('/user/:userId/manifest.json', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.getUserById(userId);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    // Generate user-specific manifest
    const userManifest = {
        ...manifest,
        id: `com.seerrcatalog.user.${userId}`,
        name: `SeerrCatalog - ${user.display_name || user.username}`
    };

    res.json(userManifest);
});

app.get('/user/:userId/catalog/:type/:id.json', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { type, id } = req.params;
        const extra = {};

        if (req.query.skip) extra.skip = req.query.skip;
        if (req.query.genre) extra.genre = req.query.genre;
        if (req.query.search) extra.search = req.query.search;

        const result = await catalogHandler({ type, id, extra, userId });
        res.json(result);
    } catch (e) {
        console.error('User catalog error:', e);
        res.json({ metas: [] });
    }
});

app.get('/user/:userId/catalog/:type/:id/:extra.json', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { type, id, extra: extraStr } = req.params;
        const extra = {};

        if (extraStr) {
            extraStr.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value) extra[key] = decodeURIComponent(value);
            });
        }

        const result = await catalogHandler({ type, id, extra, userId });
        res.json(result);
    } catch (e) {
        console.error('User catalog error:', e);
        res.json({ metas: [] });
    }
});

app.get('/user/:userId/meta/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const result = await metaHandler({ type, id });
        res.json(result);
    } catch (e) {
        console.error('Meta error:', e);
        res.json({ meta: null });
    }
});

// Auth endpoints (no auth required)
app.post('/api/auth/login', handleLogin);
app.post('/api/auth/logout', handleLogout);
app.get('/api/auth/me', getCurrentUser);

// WebUI routes with session auth
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api', (req, res, next) => {
    // Skip auth for auth endpoints
    if (req.path.startsWith('/auth/')) {
        return next();
    }
    requireAuth(req, res, next);
});
app.use('/', (req, res, next) => {
    // Skip auth for Stremio-related endpoints and login page
    if (req.path.startsWith('/manifest') ||
        req.path.startsWith('/catalog') ||
        req.path.startsWith('/meta') ||
        req.path.startsWith('/stream') ||
        req.path === '/health' ||
        req.path === '/login' ||
        req.path === '/login.html' ||
        req.path.startsWith('/api/auth/')) {
        return next();
    }
    requireAuth(req, res, next);
}, webuiRoutes);

// Start server
app.listen(PORT, HOST, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    SeerrCatalog v1.4.0                     ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  WebUI:     http://${HOST}:${PORT}/`.padEnd(60) + '║');
    console.log(`║  Stremio:   http://${HOST}:${PORT}/manifest.json`.padEnd(60) + '║');
    console.log(`║  Radarr:    http://${HOST}:${PORT}/radarr`.padEnd(60) + '║');
    console.log(`║  Sonarr:    http://${HOST}:${PORT}/sonarr`.padEnd(60) + '|');
    console.log(`║  Jellyfin:  http://${HOST}:${PORT}/jellyfin`.padEnd(60) + '|');
    console.log('|------------------------------------------------------------|');
    console.log(`║  User:      ${ADDON_USER}`.padEnd(60) + '|');
    console.log(`║  API Key:   ${API_KEY.substring(0, 20)}...`.padEnd(60) + '|');
    console.log('|------------------------------------------------------------|');
    console.log('|  Features:  🌍 FR/EN  👥 Users  ✅ Streams  🎬 Jellyfin    |');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    // Start background stream checker (checks every 24h)
    startBackgroundChecker(db);
});

module.exports = app;

