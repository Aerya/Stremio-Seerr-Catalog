/**
 * Jellyfin API Emulation
 * Minimal endpoints for Jellyseerr authentication
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { getTVShowSeasons } = require('../services/tmdb');
const { checkStreamsAvailable } = require('../services/streamChecker');

const router = express.Router();

// Re-verification interval: 1 hour in milliseconds
const REVERIFY_INTERVAL = 60 * 60 * 1000;

// Generate a Jellyfin-style UUID
function generateJellyfinId() {
    return crypto.randomUUID().replace(/-/g, '');
}

// Generate access token
function generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Store active sessions (in-memory, could be moved to DB)
const sessions = new Map();

// ============== Authentication Middleware ==============

// Middleware to extract and validate authentication token from headers
function authenticateToken(req, res, next) {
    const authHeader = req.headers['x-emby-authorization'] || req.headers['authorization'] || '';

    // Parse token from header (format: MediaBrowser Client="...", Device="...", Token="...")
    const tokenMatch = authHeader.match(/Token="?([^",\s]+)"?/i);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (token && sessions.has(token)) {
        const session = sessions.get(token);
        const user = db.getUserById(session.userId);

        if (user) {
            req.authenticatedUser = {
                ...user,
                jellyfinId: session.jellyfinId,
                sessionId: session.sessionId
            };
            console.log(`[Jellyfin] Authenticated via token: ${user.username}`);
            return next();
        }
    }

    // If no valid token, continue without authentication (some endpoints don't require it)
    next();
}

// Optional authentication - continues even if not authenticated
function optionalAuth(req, res, next) {
    authenticateToken(req, res, next);
}

// Required authentication - returns 401 if not authenticated
function requireAuth(req, res, next) {
    authenticateToken(req, res, (err) => {
        if (err) return next(err);
        if (!req.authenticatedUser) {
            console.log(`[Jellyfin] Unauthorized request to ${req.path}`);
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    });
}

// ============== System Endpoints ==============

// Helper to get server URL from request
function getServerUrl(req) {
    // If BASE_URL is explicitly set, use it
    if (process.env.BASE_URL) {
        return process.env.BASE_URL.replace(/\/$/, '');
    }

    // Detect host from reverse proxy headers or request
    const host = req.get('x-forwarded-host') || req.get('host') || `localhost:${process.env.PORT || 7000}`;

    // Detect protocol from multiple possible headers (Nginx Proxy Manager, Traefik, etc.)
    let protocol = req.get('x-forwarded-proto')
        || req.get('x-forwarded-protocol')
        || req.get('x-url-scheme')
        || req.protocol
        || 'http';

    // Ensure we only get the first protocol if multiple are listed
    protocol = protocol.split(',')[0].trim();

    const serverUrl = `${protocol}://${host}`;

    // Debug logging to help troubleshoot
    console.log(`[Jellyfin] Server URL detection:`, {
        'x-forwarded-proto': req.get('x-forwarded-proto'),
        'x-forwarded-host': req.get('x-forwarded-host'),
        'req.protocol': req.protocol,
        'final': serverUrl
    });

    return serverUrl;
}

// Public server info (no auth required, but accepts auth)
router.get('/System/Info/Public', optionalAuth, (req, res) => {
    console.log(`[Jellyfin] Public Info check from ${req.ip}`);
    const serverUrl = getServerUrl(req);
    res.json({
        LocalAddress: serverUrl,
        ServerName: 'SeerrCatalog',
        Version: '10.8.13',
        ProductName: 'Jellyfin Server',
        OperatingSystem: 'Linux',
        Id: 'seerrcatalog-jellyfin-emulated',
        StartupWizardCompleted: true
    });
});

// Full server info (auth may be required)
router.get('/System/Info', optionalAuth, (req, res) => {
    const serverUrl = getServerUrl(req);
    res.json({
        LocalAddress: serverUrl,
        ServerName: 'SeerrCatalog',
        Version: '10.8.13',
        ProductName: 'Jellyfin Server',
        OperatingSystem: 'Linux',
        Id: 'seerrcatalog-jellyfin-emulated',
        StartupWizardCompleted: true,
        CanSelfRestart: false,
        CanLaunchWebBrowser: false,
        HasPendingRestart: false,
        HasUpdateAvailable: false
    });
});

// ============== Authentication ==============

// Authenticate by username/password
router.post('/Users/AuthenticateByName', (req, res) => {
    const { Username, Pw } = req.body;

    console.log(`[Jellyfin] Auth attempt raw body:`, JSON.stringify(req.body));
    console.log(`[Jellyfin] Auth attempt for Username: ${Username}`);

    // Find user in our database
    const user = db.getUserByUsername(Username);

    if (!user) {
        console.log(`[Jellyfin] User not found: ${Username}`);
        return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Verify password
    if (!db.verifyPassword(user.id, Pw)) {
        console.log(`[Jellyfin] Invalid password for: ${Username}`);
        return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Generate access token
    const accessToken = generateAccessToken();

    // Ensure user has a Jellyfin ID
    let jellyfinId = user.jellyfin_id;
    if (!jellyfinId) {
        jellyfinId = generateJellyfinId();
        db.updateUserJellyfinId(user.id, jellyfinId);
    }

    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Store session
    sessions.set(accessToken, {
        userId: user.id,
        jellyfinId,
        username: user.username,
        sessionId
    });

    console.log(`[Jellyfin] Auth successful for: ${Username}`);

    res.json({
        User: {
            Name: user.username,
            ServerId: 'seerrcatalog',
            Id: jellyfinId,
            HasPassword: true,
            HasConfiguredPassword: true,
            HasConfiguredEasyPassword: false,
            EnableAutoLogin: false,
            Policy: {
                IsAdministrator: !!user.is_admin,
                IsHidden: false,
                IsDisabled: false,
                EnableAllFolders: true,
                EnableContentDeletion: false,
                EnableContentDownloading: false,
                EnableRemoteAccess: true,
                EnableLiveTvManagement: false,
                EnableLiveTvAccess: false,
                EnableMediaPlayback: true,
                EnableSubtitleManagement: false,
                EnableAllDevices: true,
                EnabledFolders: [],
                AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider'
            },
            PrimaryImageTag: null
        },
        SessionInfo: {
            Id: sessionId,
            UserId: jellyfinId,
            UserName: user.username,
            Client: 'Jellyseerr',
            DeviceId: req.headers['x-emby-device-id'] || 'unknown',
            DeviceName: req.headers['x-emby-device-name'] || 'Unknown Device'
        },
        AccessToken: accessToken,
        ServerId: 'seerrcatalog'
    });
});

// ============== Users Endpoints ==============

// Get all users
router.get('/Users', (req, res) => {
    const users = db.getAllUsers();

    res.json(users.map(user => ({
        Name: user.username,
        ServerId: 'seerrcatalog',
        Id: user.jellyfin_id || generateJellyfinId(),
        HasPassword: true,
        HasConfiguredPassword: true,
        HasConfiguredEasyPassword: false,
        EnableAutoLogin: false,
        LastLoginDate: user.last_login || new Date().toISOString(),
        LastActivityDate: new Date().toISOString(),
        Policy: {
            IsAdministrator: !!user.is_admin,
            IsHidden: false,
            IsDisabled: false,
            EnableAllFolders: true
        },
        PrimaryImageTag: null
    })));
});

// Get user by ID
router.get('/Users/:id', (req, res) => {
    const jellyfinId = req.params.id;
    const users = db.getAllUsers();
    const user = users.find(u => u.jellyfin_id === jellyfinId);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    res.json({
        Name: user.username,
        ServerId: 'seerrcatalog',
        Id: user.jellyfin_id,
        HasPassword: true,
        HasConfiguredPassword: true,
        HasConfiguredEasyPassword: false,
        EnableAutoLogin: false,
        Policy: {
            IsAdministrator: !!user.is_admin,
            IsHidden: false,
            IsDisabled: false,
            EnableAllFolders: true
        },
        PrimaryImageTag: null
    });
});

// Get current user (from token)
router.get('/Users/Me', (req, res) => {
    const authHeader = req.headers['x-emby-authorization'] || req.headers['authorization'] || '';
    const tokenMatch = authHeader.match(/Token="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token || !sessions.has(token)) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const session = sessions.get(token);
    const user = db.getUserById(session.userId);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    res.json({
        Name: user.username,
        ServerId: 'seerrcatalog',
        Id: session.jellyfinId,
        HasPassword: true,
        Policy: {
            IsAdministrator: !!user.is_admin,
            EnableAllFolders: true
        },
        PrimaryImageTag: null
    });
});

// ============== Library Endpoints ==============

// Pre-defined library IDs
const MOVIES_LIBRARY_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const TV_LIBRARY_ID = 'a656b907eb3a73532e40e44b968d0225';

// Media folders - Jellyseerr needs these to sync libraries
router.get('/Library/MediaFolders', (req, res) => {
    res.json({
        Items: [
            {
                Name: 'Movies',
                ServerId: 'seerrcatalog',
                Id: MOVIES_LIBRARY_ID,
                Guid: MOVIES_LIBRARY_ID,
                Type: 'CollectionFolder',
                CollectionType: 'movies',
                IsFolder: true,
                ImageTags: {},
                BackdropImageTags: [],
                LocationType: 'FileSystem',
                Path: '/media/movies'
            },
            {
                Name: 'TV Shows',
                ServerId: 'seerrcatalog',
                Id: TV_LIBRARY_ID,
                Guid: TV_LIBRARY_ID,
                Type: 'CollectionFolder',
                CollectionType: 'tvshows',
                IsFolder: true,
                ImageTags: {},
                BackdropImageTags: [],
                LocationType: 'FileSystem',
                Path: '/media/tv'
            }
        ],
        TotalRecordCount: 2,
        StartIndex: 0
    });
});

// Virtual folders
router.get('/Library/VirtualFolders', (req, res) => {
    res.json([
        {
            Name: 'Movies',
            Locations: ['/media/movies'],
            CollectionType: 'movies',
            ItemId: MOVIES_LIBRARY_ID
        },
        {
            Name: 'TV Shows',
            Locations: ['/media/tv'],
            CollectionType: 'tvshows',
            ItemId: TV_LIBRARY_ID
        }
    ]);
});

// Items endpoint - returns media items from a library
router.get('/Items', (req, res) => {
    const { ParentId, IncludeItemTypes, ids, fields } = req.query;

    console.log('[Jellyfin] GET /Items', { ParentId, IncludeItemTypes, ids, fields });

    // If specific ID(s) requested (Jellyseerr getItemData calls this)
    if (ids) {
        const idList = ids.split(',');
        const items = [];

        for (const itemId of idList) {
            const match = itemId.match(/^(movie|series)-(\d+)$/);
            if (!match) continue;

            const [, type, id] = match;
            const media = db.getMediaById(parseInt(id));

            if (!media || (type === 'movie' && media.type !== 'movie') || (type === 'series' && media.type !== 'series')) {
                continue;
            }

            // IMPORTANT: Only return media that has streams available
            // This prevents Jellyseerr from marking unavailable media as "Available"
            if (!media.streams_available) {
                console.log(`[Jellyfin] Skipping ${media.title} - no streams available`);
                continue;
            }

            // Return full item with ProviderIds (PascalCase!)
            items.push({
                Name: media.title,
                ServerId: 'seerrcatalog',
                Id: itemId,
                Type: type === 'movie' ? 'Movie' : 'Series',
                MediaType: 'Video',
                IsFolder: type === 'series',
                Path: type === 'movie'
                    ? `/media/movies/${media.title} (${media.year})/${media.title}.mkv`
                    : `/media/tv/${media.title} (${media.year})`,
                DateCreated: media.added_at || new Date().toISOString(),
                ProviderIds: {
                    Tmdb: media.tmdb_id?.toString(),
                    Imdb: media.imdb_id,
                    ...(type === 'series' && media.tvdb_id ? { Tvdb: media.tvdb_id.toString() } : {})
                },
                UserData: {
                    Played: !!media.watched,
                    UnplayedItemCount: media.watched ? 0 : 1,
                    PlaybackPositionTicks: 0,
                    IsFavorite: false,
                    Key: itemId
                },
                ImageTags: media.poster ? { Primary: 'poster' } : {},
                BackdropImageTags: media.backdrop ? ['backdrop'] : [],
                ProductionYear: media.year,
                PremiereDate: media.year ? `${media.year}-01-01T00:00:00.0000000Z` : null,
                Overview: media.overview || '',
                CommunityRating: null,
                RunTimeTicks: media.runtime ? media.runtime * 60 * 10000000 : null,
                // Additional fields Jellyseerr may request
                Width: 1920,
                Height: 1080,
                IsHD: true,
                MediaSources: [{
                    Protocol: 'File',
                    Id: itemId,
                    Path: type === 'movie'
                        ? `/media/movies/${media.title} (${media.year})/${media.title}.mkv`
                        : `/media/tv/${media.title} (${media.year})`,
                    Type: 'Default',
                    VideoType: 'VideoFile',
                    MediaStreams: [{
                        Codec: 'h264',
                        Type: 'Video',
                        Width: 1920,
                        Height: 1080
                    }]
                }]
            });
        }

        console.log(`[Jellyfin] Returning ${items.length} items for ids=${ids}`);
        if (items.length > 0) {
            console.log('[Jellyfin] Item ProviderIds:', JSON.stringify(items[0].ProviderIds));
        }

        return res.json({
            Items: items,
            TotalRecordCount: items.length,
            StartIndex: 0
        });
    }

    // Get media from database (original logic for library browsing)
    let items = [];

    if (ParentId === MOVIES_LIBRARY_ID || IncludeItemTypes?.includes('Movie')) {
        // IMPORTANT: Only return movies with streams available
        // Otherwise Jellyseerr will mark them as "Available" during Full Library Scan
        const movies = db.getMediaByType('movie').filter(m => m.streams_available);
        items = movies.map(m => ({
            Name: m.title,
            ServerId: 'seerrcatalog',
            Id: `movie-${m.id}`,
            Type: 'Movie',
            MediaType: 'Video',
            IsFolder: false,
            ProviderIds: {
                Tmdb: m.tmdb_id?.toString(),
                Imdb: m.imdb_id
            }
        }));
    } else if (ParentId === TV_LIBRARY_ID || IncludeItemTypes?.includes('Series')) {
        // IMPORTANT: Only return series with streams available
        // Otherwise Jellyseerr will mark them as "Available" during Full Library Scan
        const series = db.getMediaByType('series').filter(s => s.streams_available);
        items = series.map(s => ({
            Name: s.title,
            ServerId: 'seerrcatalog',
            Id: `series-${s.id}`,
            Type: 'Series',
            MediaType: 'Video',
            IsFolder: true,
            ProviderIds: {
                Tmdb: s.tmdb_id?.toString(),
                Imdb: s.imdb_id,
                Tvdb: s.tvdb_id?.toString()
            }
        }));
    }

    res.json({
        Items: items,
        TotalRecordCount: items.length,
        StartIndex: 0
    });
});

// User items (for library access check)
router.get('/Users/:userId/Items', (req, res) => {
    const { ParentId, IncludeItemTypes, Recursive, Fields, Ids } = req.query;
    console.log(`[Jellyfin] GET /Users/${req.params.userId}/Items`, { ParentId, IncludeItemTypes, Recursive, Fields, Ids });

    // Delegate to Items endpoint
    req.query.ParentId = ParentId;
    req.query.IncludeItemTypes = IncludeItemTypes;

    let items = [];

    if (ParentId === MOVIES_LIBRARY_ID || IncludeItemTypes?.includes('Movie')) {
        const movies = db.getMediaByType('movie'); // Returns all movies (requested + available)
        // Ideally we should filter by streams_available here if we only want to show available content in "Jellyfin"
        // But for "Requests" status syncing, Jellyseerr checks if the item exists in Jellyfin.
        // If we return it here, Jellyseerr assumes it exists.

        items = movies.filter(m => m.streams_available).map(m => ({ // ONLY return available ones?
            Name: m.title,
            ServerId: 'seerrcatalog',
            Id: `movie-${m.id}`,
            Type: 'Movie',
            MediaType: 'Video',
            IsFolder: false,
            ProviderIds: { Tmdb: m.tmdb_id?.toString(), Imdb: m.imdb_id },
            UserData: { Played: !!m.watched, UnplayedItemCount: m.watched ? 0 : 1, PlaybackPositionTicks: 0, IsFavorite: false },
            DateCreated: m.added_at,
            ProductionYear: m.year
        }));
    } else if (ParentId === TV_LIBRARY_ID || IncludeItemTypes?.includes('Series')) {
        const series = db.getMediaByType('series');
        items = series.filter(s => s.streams_available).map(s => ({
            Name: s.title,
            ServerId: 'seerrcatalog',
            Id: `series-${s.id}`,
            Type: 'Series',
            MediaType: 'Video',
            IsFolder: true,
            ProviderIds: { Tmdb: s.tmdb_id?.toString(), Imdb: s.imdb_id, Tvdb: s.tvdb_id?.toString() },
            UserData: { Played: false, UnplayedItemCount: 1, PlaybackPositionTicks: 0, IsFavorite: false },
            DateCreated: s.added_at,
            ProductionYear: s.year
        }));
    }

    // Apply basic pagination if requested? Jellyseerr usually requests all or huge limit.

    console.log(`[Jellyfin] Returning ${items.length} items for library scan`);

    res.json({
        Items: items,
        TotalRecordCount: items.length,
        StartIndex: 0
    });
});

// Get specific item by ID (for Jellyseerr to fetch item details after seeing it in Latest)
router.get('/Users/:userId/Items/:itemId', (req, res) => {
    const { itemId } = req.params;
    console.log(`[Jellyfin] GET /Users/:userId/Items/${itemId}`);

    // Parse item ID format: "movie-123" or "series-123"
    const match = itemId.match(/^(movie|series)-(\d+)$/);
    if (!match) {
        console.log(`[Jellyfin] Invalid item ID format: ${itemId}`);
        return res.status(404).json({ message: 'Item not found' });
    }

    const [, type, id] = match;
    const media = db.getMediaById(parseInt(id));

    if (!media || (type === 'movie' && media.type !== 'movie') || (type === 'series' && media.type !== 'series')) {
        return res.status(404).json({ message: 'Item not found' });
    }

    // IMPORTANT: Only return media that has streams available
    // This prevents Jellyseerr from marking unavailable media as "Available"
    if (!media.streams_available) {
        console.log(`[Jellyfin] Item ${media.title} not available - no streams found`);
        return res.status(404).json({ message: 'Item not found' });
    }

    // Return full item details with ProviderIds
    const item = {
        Name: media.title,
        ServerId: 'seerrcatalog',
        Id: itemId,
        Type: type === 'movie' ? 'Movie' : 'Series',
        MediaType: 'Video',
        IsFolder: type === 'series',
        Path: type === 'movie'
            ? `/media/movies/${media.title} (${media.year})/${media.title}.mkv`
            : `/media/tv/${media.title} (${media.year})`,
        DateCreated: media.added_at || new Date().toISOString(),
        ProviderIds: {
            Tmdb: media.tmdb_id?.toString(),
            Imdb: media.imdb_id,
            ...(type === 'series' && media.tvdb_id ? { Tvdb: media.tvdb_id.toString() } : {})
        },
        UserData: {
            Played: !!media.watched,
            UnplayedItemCount: media.watched ? 0 : 1,
            PlaybackPositionTicks: 0,
            IsFavorite: false,
            Key: itemId
        },
        ImageTags: media.poster ? { Primary: 'poster' } : {},
        BackdropImageTags: media.backdrop ? ['backdrop'] : [],
        ProductionYear: media.year,
        PremiereDate: media.year ? `${media.year}-01-01T00:00:00.0000000Z` : null,
        Overview: media.overview || '',
        CommunityRating: null,
        RunTimeTicks: media.runtime ? media.runtime * 60 * 10000000 : null
    };

    console.log('[Jellyfin] Returning item details with ProviderIds:', JSON.stringify(item.ProviderIds));
    res.json(item);
});

// User views (libraries accessible to user)
router.get('/Users/:userId/Views', (req, res) => {
    res.json({
        Items: [
            {
                Name: 'Movies',
                ServerId: 'seerrcatalog',
                Id: MOVIES_LIBRARY_ID,
                CollectionType: 'movies',
                Type: 'CollectionFolder'
            },
            {
                Name: 'TV Shows',
                ServerId: 'seerrcatalog',
                Id: TV_LIBRARY_ID,
                CollectionType: 'tvshows',
                Type: 'CollectionFolder'
            }
        ],
        TotalRecordCount: 2
    });
});

// ============== Branding ==============

router.get('/Branding/Configuration', (req, res) => {
    res.json({
        LoginDisclaimer: '',
        CustomCss: '',
        SplashscreenEnabled: false
    });
});

// ============== Plugins (empty) ==============

router.get('/Plugins', (req, res) => {
    res.json([]);
});

// ============== Activity Log ==============

router.get('/System/ActivityLog/Entries', (req, res) => {
    res.json({
        Items: [],
        TotalRecordCount: 0
    });
});

// ============== API Keys ==============

// Store API keys (in-memory)
const apiKeys = new Map();

// Get all API keys
router.get('/Auth/Keys', (req, res) => {
    const keys = Array.from(apiKeys.entries()).map(([key, data]) => ({
        AccessToken: key,
        AppName: data.appName,
        AppVersion: data.appVersion,
        DeviceId: data.deviceId,
        DeviceName: data.deviceName,
        UserId: data.userId,
        DateCreated: data.dateCreated,
        DateLastActivity: new Date().toISOString()
    }));

    res.json({
        Items: keys,
        TotalRecordCount: keys.length,
        StartIndex: 0
    });
});

// Create a new API key
router.post('/Auth/Keys', optionalAuth, (req, res) => {
    const { App } = req.query;
    const accessToken = generateAccessToken();

    apiKeys.set(accessToken, {
        appName: App || 'Jellyseerr',
        appVersion: '1.0.0',
        deviceId: req.headers['x-emby-device-id'] || 'unknown',
        deviceName: req.headers['x-emby-device-name'] || 'Unknown Device',
        userId: req.authenticatedUser ? req.authenticatedUser.jellyfinId : null,
        dateCreated: new Date().toISOString()
    });

    console.log(`[Jellyfin] API key created for: ${App}`);

    // Return the key directly in the response
    res.status(200).json({
        AccessToken: accessToken
    });
});

// Delete an API key
router.delete('/Auth/Keys/:key', (req, res) => {
    const { key } = req.params;
    apiKeys.delete(key);
    res.status(204).send();
});

// ============== TV Shows Endpoints ==============

// Get seasons for a series (required by Jellyseerr for TV show sync)
router.get('/Shows/:seriesId/Seasons', async (req, res) => {
    const { seriesId } = req.params;
    console.log(`[Jellyfin] GET /Shows/${seriesId}/Seasons`);

    // Parse series ID format: "series-123"
    const match = seriesId.match(/^series-(\d+)$/);
    if (!match) {
        console.log(`[Jellyfin] Invalid series ID format: ${seriesId}`);
        return res.status(404).json({ message: 'Series not found' });
    }

    const id = parseInt(match[1]);
    const media = db.getMediaById(id);

    if (!media || media.type !== 'series') {
        return res.status(404).json({ message: 'Series not found' });
    }

    // Only return seasons if streams are available
    if (!media.streams_available) {
        console.log(`[Jellyfin] Series ${media.title} not available - no streams found`);
        return res.status(404).json({ message: 'Series not found' });
    }

    // Fetch real seasons from TMDB
    let seasons = [];
    if (media.tmdb_id) {
        const tmdbData = await getTVShowSeasons(media.tmdb_id, db);
        if (tmdbData && tmdbData.seasons) {
            seasons = tmdbData.seasons.map(s => ({
                Name: s.name || `Season ${s.season_number}`,
                ServerId: 'seerrcatalog',
                Id: `${seriesId}-season-${s.season_number}`,
                Type: 'Season',
                SeriesId: seriesId,
                SeriesName: media.title,
                IndexNumber: s.season_number,
                ProductionYear: s.air_date ? parseInt(s.air_date.substring(0, 4)) : media.year,
                PremiereDate: s.air_date ? `${s.air_date}T00:00:00.0000000Z` : null,
                ImageTags: {},
                BackdropImageTags: [],
                LocationType: 'FileSystem',
                // Store episode count for later use
                _episodeCount: s.episode_count
            }));
        }
    }

    // Fallback to single season if TMDB fails
    if (seasons.length === 0) {
        seasons = [{
            Name: 'Season 1',
            ServerId: 'seerrcatalog',
            Id: `${seriesId}-season-1`,
            Type: 'Season',
            SeriesId: seriesId,
            SeriesName: media.title,
            IndexNumber: 1,
            ProductionYear: media.year,
            PremiereDate: media.year ? `${media.year}-01-01T00:00:00.0000000Z` : null,
            ImageTags: {},
            BackdropImageTags: [],
            LocationType: 'FileSystem',
            _episodeCount: 10
        }];
    }

    console.log(`[Jellyfin] Returning ${seasons.length} seasons for ${media.title}`);

    res.json({
        Items: seasons,
        TotalRecordCount: seasons.length,
        StartIndex: 0
    });
});

// Get episodes for a series/season (required by Jellyseerr for TV show sync)
router.get('/Shows/:seriesId/Episodes', async (req, res) => {
    const { seriesId } = req.params;
    const { seasonId } = req.query;
    console.log(`[Jellyfin] GET /Shows/${seriesId}/Episodes`, { seasonId });

    // Parse series ID format: "series-123"
    const match = seriesId.match(/^series-(\d+)$/);
    if (!match) {
        console.log(`[Jellyfin] Invalid series ID format: ${seriesId}`);
        return res.status(404).json({ message: 'Series not found' });
    }

    const id = parseInt(match[1]);
    const media = db.getMediaById(id);

    if (!media || media.type !== 'series') {
        return res.status(404).json({ message: 'Series not found' });
    }

    // Only return episodes if streams are available
    if (!media.streams_available) {
        console.log(`[Jellyfin] Series ${media.title} not available - no streams found`);
        return res.status(404).json({ message: 'Series not found' });
    }

    // Parse season number from seasonId (e.g., "series-20-season-1" -> 1)
    let seasonNumber = 1;
    if (seasonId) {
        const seasonMatch = seasonId.match(/season-(\d+)$/);
        if (seasonMatch) {
            seasonNumber = parseInt(seasonMatch[1]);
        }
    }

    // Get episode count from TMDB
    let episodeCount = 10; // Default
    if (media.tmdb_id) {
        const tmdbData = await getTVShowSeasons(media.tmdb_id, db);
        if (tmdbData && tmdbData.seasons) {
            const season = tmdbData.seasons.find(s => s.season_number === seasonNumber);
            if (season) {
                episodeCount = season.episode_count;
            }
        }
    }

    // Generate episodes for this season
    const episodes = [];
    for (let i = 1; i <= episodeCount; i++) {
        episodes.push({
            Name: `Episode ${i}`,
            ServerId: 'seerrcatalog',
            Id: `${seriesId}-s${seasonNumber}e${i}`,
            Type: 'Episode',
            SeriesId: seriesId,
            SeriesName: media.title,
            SeasonId: seasonId || `${seriesId}-season-${seasonNumber}`,
            SeasonName: `Season ${seasonNumber}`,
            IndexNumber: i,
            ParentIndexNumber: seasonNumber,
            ProductionYear: media.year,
            PremiereDate: media.year ? `${media.year}-01-01T00:00:00.0000000Z` : null,
            MediaType: 'Video',
            LocationType: 'FileSystem',
            Path: `/media/tv/${media.title} (${media.year})/Season ${String(seasonNumber).padStart(2, '0')}/S${String(seasonNumber).padStart(2, '0')}E${String(i).padStart(2, '0')}.mkv`,
            ImageTags: {},
            BackdropImageTags: [],
            // MediaSources for resolution detection
            MediaSources: [{
                Protocol: 'File',
                Id: `${seriesId}-s${seasonNumber}e${i}-source`,
                Path: `/media/tv/${media.title} (${media.year})/Season ${String(seasonNumber).padStart(2, '0')}/S${String(seasonNumber).padStart(2, '0')}E${String(i).padStart(2, '0')}.mkv`,
                Type: 'Default',
                VideoType: 'VideoFile',
                MediaStreams: [{
                    Codec: 'h264',
                    Type: 'Video',
                    Width: 1920,
                    Height: 1080
                }]
            }]
        });
    }

    console.log(`[Jellyfin] Returning ${episodes.length} episodes for ${media.title} S${seasonNumber}`);

    res.json({
        Items: episodes,
        TotalRecordCount: episodes.length,
        StartIndex: 0
    });
});

// ============== Images (1x1 Transparent PNG) ==============

// Handle all image requests with a transparent 1x1 PNG
router.get(/.*\/Images\/.*/, (req, res) => {
    console.log(`[Jellyfin] Image request: ${req.path}`);
    // 1x1 Transparent PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length
    });
    res.end(png);
});

// ============== Recently Added Items ==============

// Items/Latest - Returns recently added items with available streams
// This is what Jellyseerr uses to detect when media becomes available
router.get('/Items/Latest', (req, res) => {
    const { ParentId, Limit, IncludeItemTypes } = req.query;
    const limit = parseInt(Limit) || 16;

    console.log('[Jellyfin] GET /Items/Latest', { ParentId, Limit: limit, IncludeItemTypes });

    let items = [];
    let mediaToReverify = []; // Track items that need re-verification

    // Get movies with available streams
    if (!ParentId || ParentId === MOVIES_LIBRARY_ID || IncludeItemTypes?.includes('Movie')) {
        const movies = db.getMediaByType('movie')
            .filter(m => m.streams_available) // Only return media with streams
            .sort((a, b) => new Date(b.added_at) - new Date(a.added_at)) // Most recent first
            .slice(0, limit);

        // Check which movies need re-verification (last check > 1 hour ago)
        for (const m of movies) {
            const lastCheck = m.last_stream_check ? new Date(m.last_stream_check).getTime() : 0;
            if (Date.now() - lastCheck > REVERIFY_INTERVAL) {
                mediaToReverify.push(m);
            }
        }

        items.push(...movies.map(m => ({
            Name: m.title,
            ServerId: 'seerrcatalog',
            Id: `movie-${m.id}`,
            Type: 'Movie',
            MediaType: 'Video',
            IsFolder: false,
            Path: `/media/movies/${m.title} (${m.year})/${m.title}.mkv`,
            DateCreated: m.added_at || new Date().toISOString(),
            ProviderIds: {
                Tmdb: m.tmdb_id?.toString(),
                Imdb: m.imdb_id
            },
            UserData: {
                Played: !!m.watched,
                UnplayedItemCount: m.watched ? 0 : 1,
                PlaybackPositionTicks: 0,
                IsFavorite: false,
                Key: `movie-${m.id}`
            },
            ImageTags: m.poster ? { Primary: 'poster' } : {},
            BackdropImageTags: m.backdrop ? ['backdrop'] : [],
            ProductionYear: m.year,
            PremiereDate: m.year ? `${m.year}-01-01T00:00:00.0000000Z` : null,
            Overview: m.overview || '',
            CommunityRating: null,
            RunTimeTicks: m.runtime ? m.runtime * 60 * 10000000 : null
        })));
    }

    // Get series with available streams
    if (!ParentId || ParentId === TV_LIBRARY_ID || IncludeItemTypes?.includes('Series')) {
        const series = db.getMediaByType('series')
            .filter(s => s.streams_available) // Only return media with streams
            .sort((a, b) => new Date(b.added_at) - new Date(a.added_at)) // Most recent first
            .slice(0, limit);

        // Check which series need re-verification
        for (const s of series) {
            const lastCheck = s.last_stream_check ? new Date(s.last_stream_check).getTime() : 0;
            if (Date.now() - lastCheck > REVERIFY_INTERVAL) {
                mediaToReverify.push(s);
            }
        }

        items.push(...series.map(s => ({
            Name: s.title,
            ServerId: 'seerrcatalog',
            Id: `series-${s.id}`,
            Type: 'Series',
            MediaType: 'Video',
            IsFolder: true,
            Path: `/media/tv/${s.title} (${s.year})`,
            DateCreated: s.added_at || new Date().toISOString(),
            ProviderIds: {
                Tmdb: s.tmdb_id?.toString(),
                Imdb: s.imdb_id,
                Tvdb: s.tvdb_id?.toString()
            },
            UserData: {
                Played: false,
                UnplayedItemCount: 1,
                PlaybackPositionTicks: 0,
                IsFavorite: false,
                Key: `series-${s.id}`
            },
            ImageTags: s.poster ? { Primary: 'poster' } : {},
            BackdropImageTags: s.backdrop ? ['backdrop'] : [],
            ProductionYear: s.year,
            PremiereDate: s.year ? `${s.year}-01-01T00:00:00.0000000Z` : null,
            Overview: s.overview || '',
            CommunityRating: null
        })));
    }

    // Sort all items by date and limit
    items = items
        .sort((a, b) => new Date(b.DateCreated) - new Date(a.DateCreated))
        .slice(0, limit);

    console.log(`[Jellyfin] Returning ${items.length} recently added items with streams`);
    if (items.length > 0) {
        console.log('[Jellyfin] Sample item:', JSON.stringify(items[0], null, 2));
    }

    // Send response immediately (no blocking)
    res.json(items);

    // Trigger background re-verification for items that need it
    if (mediaToReverify.length > 0) {
        console.log(`[Jellyfin] 🔄 Triggering background re-verification for ${mediaToReverify.length} items...`);

        setImmediate(async () => {
            for (const media of mediaToReverify) {
                try {
                    console.log(`[Jellyfin] Re-verifying streams for: ${media.title}`);
                    const result = await checkStreamsAvailable(media, db);
                    db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);

                    if (result.available) {
                        console.log(`[Jellyfin] ✅ Re-check passed for: ${media.title} (${result.streamCount} streams)`);
                    } else {
                        console.log(`[Jellyfin] ⚠️ Re-check FAILED for: ${media.title} - marking unavailable`);
                    }
                } catch (e) {
                    console.error(`[Jellyfin] Re-verification error for ${media.title}:`, e.message);
                }

                // Small delay between checks to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            console.log(`[Jellyfin] 🔄 Background re-verification complete`);
        });
    }
});

// ============== Catch-all for unsupported endpoints ==============

router.all('*', (req, res) => {
    console.log(`[Jellyfin] Unhandled: ${req.method} ${req.path}`);
    res.json({});
});

module.exports = router;
