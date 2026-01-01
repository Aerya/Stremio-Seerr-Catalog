const express = require('express');
const db = require('../db');
const { checkStreamsAvailable } = require('../services/streamChecker');
const { getTMDBDetails } = require('../services/tmdb');

const router = express.Router();

// API Key for validation (Jellyseerr sends this in X-Api-Key header)
const VALID_API_KEY = 'seerrcatalog-api-key';

// Middleware to validate API key (optional - returns 401 if invalid)
function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    // Accept any key for now, or validate against our known key
    if (apiKey && apiKey !== VALID_API_KEY) {
        console.log('[Radarr] Invalid API key provided:', apiKey);
    }
    next();
}

router.use(validateApiKey);
router.get('/api/v3/system/status', (req, res) => {
    res.json({
        appName: 'Radarr',
        instanceName: 'SeerrCatalog',
        version: '5.2.6.8376',
        buildTime: '2024-01-01T00:00:00Z',
        isDebug: false,
        isProduction: true,
        isAdmin: true,
        isUserInteractive: false,
        startupPath: '/app',
        appData: '/app/data',
        osName: 'Linux',
        isDocker: true,
        isMono: false,
        isLinux: true,
        isOsx: false,
        isWindows: false,
        isNetCore: true,
        runtimeVersion: '8.0.0',
        runtimeName: '.NET',
        startTime: new Date().toISOString(),
        packageVersion: '5.2.6.8376',
        packageAuthor: 'SeerrCatalog',
        packageUpdateMechanism: 'docker'
    });
});

// Root folders
router.get('/api/v3/rootfolder', (req, res) => {
    res.json([
        {
            id: 1,
            path: '/movies',
            accessible: true,
            freeSpace: 1000000000000,
            unmappedFolders: []
        }
    ]);
});

// Quality profiles
router.get('/api/v3/qualityprofile', (req, res) => {
    res.json([
        {
            id: 1,
            name: 'Any',
            upgradeAllowed: true,
            cutoff: 1,
            items: [],
            minFormatScore: 0,
            cutoffFormatScore: 0,
            formatItems: []
        },
        {
            id: 2,
            name: 'HD-1080p',
            upgradeAllowed: true,
            cutoff: 1,
            items: [],
            minFormatScore: 0,
            cutoffFormatScore: 0,
            formatItems: []
        },
        {
            id: 3,
            name: '4K',
            upgradeAllowed: true,
            cutoff: 1,
            items: [],
            minFormatScore: 0,
            cutoffFormatScore: 0,
            formatItems: []
        }
    ]);
});

// Tags
router.get('/api/v3/tag', (req, res) => {
    res.json([]);
});

// Convert DB movie to Radarr format
function toRadarrMovie(media, idx = 0) {
    const hasFile = !!media.streams_available;

    // Create movieFile object if streams are available (Jellyseerr needs this)
    const movieFile = hasFile ? {
        id: media.id,
        movieId: media.id,
        relativePath: `${media.title} (${media.year || 'Unknown'})/${media.title}.mkv`,
        path: `/movies/${media.title} (${media.year || 'Unknown'})/${media.title}.mkv`,
        size: media.stream_count ? media.stream_count * 5000000000 : 10000000000, // Approximate size
        dateAdded: media.last_stream_check || media.added_at,
        quality: {
            quality: { id: 7, name: '1080p', source: 'webdl', resolution: 1080 },
            revision: { version: 1, real: 0, isRepack: false }
        },
        mediaInfo: null,
        qualityCutoffNotMet: false,
        languages: [{ id: 1, name: 'English' }],
        edition: ''
    } : null;

    return {
        id: media.id,
        title: media.title,
        originalTitle: media.original_title || media.title,
        originalLanguage: { id: 1, name: 'English' },
        alternateTitles: [],
        sortTitle: media.title.toLowerCase(),
        sizeOnDisk: hasFile ? 10000000000 : 0,
        status: 'released',
        overview: media.overview || '',
        inCinemas: media.year ? `${media.year}-01-01` : null,
        physicalRelease: media.year ? `${media.year}-06-01` : null,
        digitalRelease: media.year ? `${media.year}-06-01` : null,
        images: media.poster ? [
            { coverType: 'poster', url: media.poster, remoteUrl: media.poster }
        ] : [],
        website: '',
        year: media.year || 0,
        hasFile: hasFile,
        youTubeTrailerId: '',
        studio: '',
        path: `/movies/${media.title} (${media.year || 'Unknown'})`,
        qualityProfileId: 1,
        monitored: !!media.monitored,
        minimumAvailability: 'announced',
        isAvailable: true,
        folderName: `${media.title} (${media.year || 'Unknown'})`,
        runtime: media.runtime || 0,
        cleanTitle: media.title.toLowerCase().replace(/[^a-z0-9]/g, ''),
        imdbId: media.imdb_id || '',
        tmdbId: media.tmdb_id || 0,
        titleSlug: media.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        certification: '',
        genres: media.genres || [],
        tags: [],
        added: media.added_at,
        ratings: { imdb: { votes: 0, value: 0, type: 'user' } },
        movieFile: movieFile,
        collection: null,
        popularity: 0
    };
}

// Get all movies
router.get('/api/v3/movie', (req, res) => {
    const { tmdbId, imdbId } = req.query;

    if (tmdbId) {
        const media = db.getMediaByTmdb('movie', parseInt(tmdbId));
        return res.json(media ? [toRadarrMovie(media)] : []);
    }

    if (imdbId) {
        const media = db.getMediaByImdb(imdbId);
        if (media && media.type === 'movie') {
            return res.json([toRadarrMovie(media)]);
        }
        return res.json([]);
    }

    const movies = db.getMediaByType('movie');
    res.json(movies.map((m, i) => toRadarrMovie(m, i)));
});

// Lookup movie (search TMDB - needed by Jellyseerr before adding)
router.get('/api/v3/movie/lookup', async (req, res) => {
    let { term, tmdbId } = req.query;

    console.log('[Radarr] Movie lookup requested:', { term, tmdbId });

    // Parse tmdbId from term if in format "tmdb:12345"
    if (!tmdbId && term) {
        const tmdbMatch = term.match(/^tmdb:(\d+)$/i);
        if (tmdbMatch) {
            tmdbId = tmdbMatch[1];
            console.log('[Radarr] Parsed TMDB ID from term:', tmdbId);
        }
    }

    // If tmdbId is provided, fetch from TMDB
    if (tmdbId) {
        try {
            const details = await getTMDBDetails(parseInt(tmdbId), 'movie', db);
            if (details) {
                console.log('[Radarr] Found TMDB data for:', details.title);
                // Convert to Radarr format
                const radarrMovie = {
                    title: details.title,
                    originalTitle: details.original_title || details.title,
                    alternateTitles: [],
                    sortTitle: details.title.toLowerCase(),
                    status: 'released',
                    overview: details.overview || '',
                    images: details.poster ? [
                        { coverType: 'poster', url: details.poster, remoteUrl: details.poster }
                    ] : [],
                    year: details.year || 0,
                    hasFile: false,
                    youTubeTrailerId: '',
                    studio: '',
                    qualityProfileId: 1,
                    monitored: true,
                    minimumAvailability: 'announced',
                    isAvailable: true,
                    runtime: details.runtime || 0,
                    cleanTitle: details.title.toLowerCase().replace(/[^a-z0-9]/g, ''),
                    imdbId: details.imdb_id || '',
                    tmdbId: parseInt(tmdbId),
                    titleSlug: details.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    certification: '',
                    genres: details.genres || [],
                    tags: [],
                    ratings: { imdb: { votes: 0, value: 0, type: 'user' } }
                };
                return res.json([radarrMovie]);
            } else {
                // TMDB API not configured or failed - return minimal data
                // Jellyseerr will send full data in POST anyway
                console.log('[Radarr] TMDB not configured, returning minimal lookup data');
                const minimalMovie = {
                    title: `Movie ${tmdbId}`,
                    originalTitle: `Movie ${tmdbId}`,
                    alternateTitles: [],
                    sortTitle: `movie${tmdbId}`,
                    status: 'released',
                    overview: '',
                    images: [],
                    year: 0,
                    hasFile: false,
                    youTubeTrailerId: '',
                    studio: '',
                    qualityProfileId: 1,
                    monitored: true,
                    minimumAvailability: 'announced',
                    isAvailable: true,
                    runtime: 0,
                    cleanTitle: `movie${tmdbId}`,
                    imdbId: '',
                    tmdbId: parseInt(tmdbId),
                    titleSlug: `movie-${tmdbId}`,
                    certification: '',
                    genres: [],
                    tags: [],
                    ratings: { imdb: { votes: 0, value: 0, type: 'user' } }
                };
                return res.json([minimalMovie]);
            }
        } catch (e) {
            console.error('[Radarr] TMDB lookup error:', e.message);
        }
    }

    // Default: return empty array
    res.json([]);
});

// Get single movie by ID
// IMPORTANT: This parametric route must be AFTER /lookup to avoid route conflict!
router.get('/api/v3/movie/:id', (req, res) => {
    const media = db.getMediaById(parseInt(req.params.id));
    if (!media || media.type !== 'movie') {
        return res.status(404).json({ message: 'Movie not found' });
    }
    res.json(toRadarrMovie(media));
});

// Add movie - THIS IS THE MAIN ENDPOINT
router.post('/api/v3/movie', async (req, res) => {
    const body = req.body;

    console.log('[Radarr] Adding movie:', body.title);

    // Check if movie already exists
    if (body.tmdbId) {
        const existing = db.getMediaByTmdb('movie', body.tmdbId);
        if (existing) {
            console.log('[Radarr] Movie already exists:', existing.id);
            return res.json(toRadarrMovie(existing));
        }
    }

    // Extract images
    let poster = null;
    let backdrop = null;
    if (body.images) {
        const posterImg = body.images.find(i => i.coverType === 'poster');
        const backdropImg = body.images.find(i => i.coverType === 'fanart' || i.coverType === 'backdrop');
        poster = posterImg?.remoteUrl || posterImg?.url;
        backdrop = backdropImg?.remoteUrl || backdropImg?.url;
    }

    // Fallback: If no poster, try to fetch from TMDB
    if (!poster && body.tmdbId) {
        try {
            console.log(`[Radarr] Missing poster for ${body.title}, fetching from TMDB...`);
            const details = await getTMDBDetails(body.tmdbId, 'movie', db);
            if (details) {
                if (details.poster) poster = details.poster;
                if (details.backdrop && !backdrop) backdrop = details.backdrop;
                if (!body.overview && details.overview) body.overview = details.overview;
                if (!body.year && details.year) body.year = details.year;
                if (!body.genres && details.genres) body.genres = details.genres;
                if (!body.runtime && details.runtime) body.runtime = details.runtime;
                if (!body.imdbId && details.imdb_id) body.imdbId = details.imdb_id;  // IMDB ID pour stream check
                console.log('[Radarr] Retrieved metadata from TMDB, IMDB:', body.imdbId);
            }
        } catch (e) {
            console.error('[Radarr] TMDB fallback error:', e.message);
        }
    }


    // Add to database with pending status
    // Assign to specific user if provided via user-specific route, else admin (ID=1)
    const userId = req.seerrcatalogUserId || 1;
    const media = db.addMedia({
        user_id: userId,
        type: 'movie',
        tmdb_id: body.tmdbId,
        imdb_id: body.imdbId,
        title: body.title,
        original_title: body.originalTitle,
        year: body.year,
        poster: poster,
        backdrop: backdrop,
        overview: body.overview,
        genres: body.genres,
        runtime: body.runtime,
        status: 'pending', // Will be updated after stream check
        monitored: body.monitored !== false
    });

    console.log('[Radarr] Movie added:', media.id, media.title);

    // Trigger async stream check (don't wait for response)
    setImmediate(async () => {
        try {
            const result = await checkStreamsAvailable(media, db);
            db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
            if (result.available) {
                console.log(`[Radarr] ✅ Streams found for: ${media.title} (${result.streamCount} streams)`);

                // Notify Jellyseerr that content is now available
                const { notifyMediaAvailable } = require('../services/jellyseerr');
                await notifyMediaAvailable(media);
            } else {
                console.log(`[Radarr] ⚠️ No streams found for: ${media.title}`);
            }
        } catch (e) {
            console.error('[Radarr] Stream check error:', e.message);
        }
    });

    res.status(201).json(toRadarrMovie(media));
});

// Update movie
router.put('/api/v3/movie/:id', (req, res) => {
    const media = db.getMediaById(parseInt(req.params.id));
    if (!media || media.type !== 'movie') {
        return res.status(404).json({ message: 'Movie not found' });
    }

    // For now, just return the existing movie
    // Could implement update logic if needed
    res.json(toRadarrMovie(media));
});

// Delete movie
router.delete('/api/v3/movie/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const media = db.getMediaById(id);

    if (!media || media.type !== 'movie') {
        return res.status(404).json({ message: 'Movie not found' });
    }

    db.deleteMedia(id);
    console.log('[Radarr] Movie deleted:', id, media.title);

    res.status(200).json({});
});

// Command endpoint (for triggering searches, etc.)
router.post('/api/v3/command', (req, res) => {
    const { name } = req.body;
    console.log('[Radarr] Command received:', name);

    // Return a fake command response
    res.json({
        id: 1,
        name: name,
        commandName: name,
        message: 'Command completed',
        priority: 'normal',
        status: 'completed',
        queued: new Date().toISOString(),
        started: new Date().toISOString(),
        ended: new Date().toISOString(),
        trigger: 'manual'
    });
});

// Queue (downloads in progress)
router.get('/api/v3/queue', (req, res) => {
    res.json({
        page: 1,
        pageSize: 10,
        sortKey: 'timeleft',
        sortDirection: 'ascending',
        totalRecords: 0,
        records: []
    });
});

// History
router.get('/api/v3/history', (req, res) => {
    res.json({
        page: 1,
        pageSize: 10,
        sortKey: 'date',
        sortDirection: 'descending',
        totalRecords: 0,
        records: []
    });
});

module.exports = router;
