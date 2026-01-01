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
app.get('/api/auth/has-users', (req, res) => {
    const users = db.getAllUsers();
    res.json({ hasUsers: users && users.length > 0 });
});
app.post('/api/auth/create-first-user', (req, res) => {
    const users = db.getAllUsers();
    if (users && users.length > 0) {
        return res.status(403).json({ error: 'Users already exist' });
    }

    const { username, password, display_name } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    // createUser will hash the password internally
    const user = db.createUser(username, password, display_name || username, true);

    console.log(`[Auth] First user created: ${username} (ID: ${user.id})`);
    res.json({ success: true, userId: user.id });
});

// WebUI routes with session auth
app.use('/api/users', requireAuth, usersRoutes);

// Jellyseerr connection test endpoint
app.post('/api/jellyseerr/test', requireAuth, async (req, res) => {
    const { url, apiKey } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL required' });
    }

    try {
        const https = require('https');
        const http = require('http');
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: '/api/v1/status',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000
        };

        if (apiKey) {
            options.headers['X-Api-Key'] = apiKey.trim();
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;

        const request = protocol.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                if (response.statusCode === 200) {
                    try {
                        const jsonData = JSON.parse(data);
                        res.json({
                            success: true,
                            version: jsonData.version || 'unknown',
                            message: `Connected to Jellyseerr v${jsonData.version || 'unknown'}`
                        });
                    } catch (e) {
                        res.json({
                            success: true,
                            message: 'Connected to Jellyseerr'
                        });
                    }
                } else {
                    res.status(response.statusCode).json({
                        error: `Connection failed: ${response.statusCode} ${response.statusMessage}`
                    });
                }
            });
        });

        request.on('error', (e) => {
            console.error('[Jellyseerr Test] Error:', e.message);
            res.status(500).json({ error: `Connection error: ${e.message}` });
        });

        request.on('timeout', () => {
            request.destroy();
            res.status(500).json({ error: 'Connection timeout' });
        });

        request.end();
    } catch (e) {
        console.error('[Jellyseerr Test] Error:', e.message);
        res.status(500).json({ error: `Connection error: ${e.message}` });
    }
});

app.use('/api', (req, res, next) => {
    // Skip auth for auth endpoints
    if (req.path.startsWith('/auth/')) {
        return next();
    }
    requireAuth(req, res, next);
});
app.use('/', (req, res, next) => {
    // Skip auth for Stremio-related endpoints, login page, and static files
    if (req.path.startsWith('/manifest') ||
        req.path.startsWith('/catalog') ||
        req.path.startsWith('/meta') ||
        req.path.startsWith('/stream') ||
        req.path === '/health' ||
        req.path === '/login' ||
        req.path === '/login.html' ||
        req.path.startsWith('/api/auth/') ||
        req.path.endsWith('.css') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.png') ||
        req.path.endsWith('.jpg') ||
        req.path.endsWith('.jpeg') ||
        req.path.endsWith('.gif') ||
        req.path.endsWith('.svg') ||
        req.path.endsWith('.ico') ||
        req.path.endsWith('.woff') ||
        req.path.endsWith('.woff2') ||
        req.path.endsWith('.ttf') ||
        req.path.endsWith('.webp')) {
        return next();
    }
    requireAuth(req, res, next);
}, webuiRoutes);

// Start server
app.listen(PORT, HOST, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              SeerrCatalog by Aerya                     ║');
    console.log('║  https://github.com/Aerya/Stremio-Seerr-Catalog        ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Server running on http://${HOST}:${PORT}`.padEnd(57) + '║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    // Start background stream checker (checks every 24h)
    startBackgroundChecker(db);
});

module.exports = app;

