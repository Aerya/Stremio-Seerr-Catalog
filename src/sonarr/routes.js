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
        console.log('[Sonarr] Invalid API key provided:', apiKey);
    }
    next();
}

router.use(validateApiKey);

// Sonarr system status
router.get('/api/v3/system/status', (req, res) => {
    res.json({
        appName: 'Sonarr',
        instanceName: 'SeerrCatalog',
        version: '4.0.1.929',
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
        packageVersion: '4.0.1.929',
        packageAuthor: 'SeerrCatalog',
        packageUpdateMechanism: 'docker'
    });
});

// Root folders
router.get('/api/v3/rootfolder', (req, res) => {
    res.json([
        {
            id: 1,
            path: '/tv',
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

// Language profiles
router.get('/api/v3/languageprofile', (req, res) => {
    res.json([
        {
            id: 1,
            name: 'English',
            upgradeAllowed: true,
            cutoff: { id: 1, name: 'English' },
            languages: [{ language: { id: 1, name: 'English' }, allowed: true }]
        }
    ]);
});

// Tags
router.get('/api/v3/tag', (req, res) => {
    res.json([]);
});

// Convert DB series to Sonarr format
function toSonarrSeries(media, episodes = []) {
    // Group episodes by season
    const seasons = {};
    episodes.forEach(ep => {
        if (!seasons[ep.season_number]) {
            seasons[ep.season_number] = {
                seasonNumber: ep.season_number,
                monitored: true,
                statistics: { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 0 }
            };
        }
        seasons[ep.season_number].statistics.totalEpisodeCount++;
        seasons[ep.season_number].statistics.episodeCount++;
        if (media.streams_available) {
            seasons[ep.season_number].statistics.episodeFileCount++;
        }
    });

    return {
        id: media.id,
        title: media.title,
        alternateTitles: [],
        sortTitle: media.title.toLowerCase(),
        status: 'continuing',
        ended: false,
        overview: media.overview || '',
        previousAiring: new Date().toISOString(),
        network: '',
        airTime: '21:00',
        images: media.poster ? [
            { coverType: 'poster', url: media.poster, remoteUrl: media.poster }
        ] : [],
        originalLanguage: { id: 1, name: 'English' },
        seasons: Object.values(seasons),
        year: media.year || 0,
        path: `/tv/${media.title}`,
        qualityProfileId: 1,
        languageProfileId: 1,
        seasonFolder: true,
        monitored: !!media.monitored,
        useSceneNumbering: false,
        runtime: media.runtime || 45,
        tvdbId: media.tvdb_id || 0,
        tvRageId: 0,
        tvMazeId: 0,
        firstAired: media.year ? `${media.year}-01-01` : null,
        seriesType: 'standard',
        cleanTitle: media.title.toLowerCase().replace(/[^a-z0-9]/g, ''),
        imdbId: media.imdb_id || '',
        titleSlug: media.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        rootFolderPath: '/tv',
        certification: '',
        genres: media.genres || [],
        tags: [],
        added: media.added_at,
        ratings: { votes: 0, value: 0 },
        statistics: {
            seasonCount: Object.keys(seasons).length,
            episodeFileCount: media.streams_available ? episodes.length : 0,
            episodeCount: episodes.length,
            totalEpisodeCount: episodes.length,
            sizeOnDisk: 0,
            percentOfEpisodes: media.streams_available ? 100 : 0
        }
    };
}

// Get all series
router.get('/api/v3/series', (req, res) => {
    const { tvdbId, imdbId } = req.query;

    if (tvdbId) {
        const allSeries = db.getMediaByType('series');
        const media = allSeries.find(s => s.tvdb_id === parseInt(tvdbId));
        if (media) {
            const episodes = db.getEpisodes(media.id);
            return res.json([toSonarrSeries(media, episodes)]);
        }
        return res.json([]);
    }

    if (imdbId) {
        const media = db.getMediaByImdb(imdbId);
        if (media && media.type === 'series') {
            const episodes = db.getEpisodes(media.id);
            return res.json([toSonarrSeries(media, episodes)]);
        }
        return res.json([]);
    }

    const series = db.getMediaByType('series');
    res.json(series.map(s => {
        const episodes = db.getEpisodes(s.id);
        return toSonarrSeries(s, episodes);
    }));
});

// Lookup series (needed by Jellyseerr before adding)
// IMPORTANT: This must be BEFORE /api/v3/series/:id to avoid route conflict!
router.get('/api/v3/series/lookup', async (req, res) => {
    let { term, tvdbId } = req.query;

    console.log('[Sonarr] Series lookup requested:', { term, tvdbId });

    // Parse tvdbId from term if in format "tvdb:12345"
    if (!tvdbId && term) {
        const tvdbMatch = term.match(/^tvdb:(\d+)$/i);
        if (tvdbMatch) {
            tvdbId = tvdbMatch[1];
            console.log('[Sonarr] Parsed TVDB ID from term:', tvdbId);
        }
    }

    // If tvdbId is provided, try to get series info from TMDB
    if (tvdbId) {
        try {
            console.log('[Sonarr] Lookup for TVDB ID:', tvdbId);

            // Try to find TMDB ID from TVDB ID using TMDB's find endpoint
            const { findByExternalId } = require('../services/tmdb');
            const tmdbResults = await findByExternalId(tvdbId, 'tvdb_id', db);

            if (tmdbResults && tmdbResults.tv_results && tmdbResults.tv_results.length > 0) {
                const show = tmdbResults.tv_results[0];
                console.log('[Sonarr] Found series via TMDB:', show.name);

                // Get full details including IMDB ID
                const details = await getTMDBDetails(show.id, 'series', db);

                // Return in Sonarr lookup format
                const result = {
                    title: show.name,
                    sortTitle: show.name.toLowerCase(),
                    status: 'continuing',
                    ended: false,
                    overview: show.overview || '',
                    network: '',
                    airTime: '',
                    images: show.poster_path ? [
                        { coverType: 'poster', url: `https://image.tmdb.org/t/p/w500${show.poster_path}`, remoteUrl: `https://image.tmdb.org/t/p/w500${show.poster_path}` }
                    ] : [],
                    remotePoster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : null,
                    seasons: [],
                    year: show.first_air_date ? parseInt(show.first_air_date.substring(0, 4)) : 0,
                    firstAired: show.first_air_date || null,
                    qualityProfileId: 1,
                    languageProfileId: 1,
                    seasonFolder: true,
                    monitored: true,
                    tvdbId: parseInt(tvdbId),
                    tvRageId: 0,
                    tvMazeId: 0,
                    imdbId: details?.imdb_id || '',
                    tmdbId: show.id,
                    titleSlug: show.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    seriesType: 'standard',
                    cleanTitle: show.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                    certification: '',
                    genres: show.genre_ids || [],
                    tags: [],
                    added: new Date().toISOString(),
                    ratings: { votes: show.vote_count || 0, value: show.vote_average || 0 },
                    statistics: {
                        seasonCount: 1,
                        episodeFileCount: 0,
                        episodeCount: 0,
                        totalEpisodeCount: 0,
                        sizeOnDisk: 0,
                        percentOfEpisodes: 0
                    },
                    rootFolderPath: '/tv',
                    addOptions: {
                        ignoreEpisodesWithFiles: false,
                        ignoreEpisodesWithoutFiles: false,
                        searchForMissingEpisodes: true
                    }
                };

                return res.json([result]);
            }
        } catch (e) {
            console.error('[Sonarr] TVDB lookup error:', e.message);
        }
    }

    // Fallback: Return empty if we couldn't find it
    console.log('[Sonarr] Lookup returned no results');
    res.json([]);
});

// Get single series by ID
// IMPORTANT: This parametric route must be AFTER /lookup to avoid route conflict!
router.get('/api/v3/series/:id', (req, res) => {
    const media = db.getMediaById(parseInt(req.params.id));
    if (!media || media.type !== 'series') {
        return res.status(404).json({ message: 'Series not found' });
    }
    const episodes = db.getEpisodes(media.id);
    res.json(toSonarrSeries(media, episodes));
});

// Add series - THIS IS THE MAIN ENDPOINT
router.post('/api/v3/series', async (req, res) => {
    try {
        const body = req.body;

        console.log('[Sonarr] Adding series:', body.title);

        // Check if series already exists
        if (body.tvdbId) {
            const allSeries = db.getMediaByType('series');
            const existing = allSeries.find(s => s.tvdb_id === body.tvdbId);
            if (existing) {
                console.log('[Sonarr] Series already exists:', existing.id);
                const episodes = db.getEpisodes(existing.id);
                return res.json(toSonarrSeries(existing, episodes));
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
        if (!poster) {
            try {
                console.log(`[Sonarr] Missing poster for ${body.title}, trying TMDB fallback...`);
                let tmdbId = body.tmdbId;

                // If no TMDB ID, try to search by title
                if (!tmdbId && body.title) {
                    const { searchTMDB } = require('../services/tmdb');
                    const results = await searchTMDB(body.title, 'tv', db);
                    if (results && results.length > 0) {
                        tmdbId = results[0].tmdb_id;
                        console.log(`[Sonarr] Found TMDB ID via search: ${tmdbId}`);
                    }
                }

                if (tmdbId) {
                    const details = await getTMDBDetails(tmdbId, 'series', db);
                    if (details) {
                        if (details.poster) poster = details.poster;
                        if (details.backdrop && !backdrop) backdrop = details.backdrop;
                        // Update body properties if missing
                        if (!body.overview && details.overview) body.overview = details.overview;
                        if (!body.year && details.year) body.year = details.year;
                        if (!body.genres && details.genres) body.genres = details.genres;
                        if (!body.runtime && details.runtime) body.runtime = details.runtime;
                        if (!body.tmdbId) body.tmdbId = tmdbId; // Save the discovered ID
                        if (!body.imdbId && details.imdb_id) body.imdbId = details.imdb_id;  // IMDB ID pour stream check
                        console.log('[Sonarr] Retrieved metadata from TMDB, IMDB:', body.imdbId);
                    }
                }
            } catch (e) {
                console.error('[Sonarr] TMDB fallback error:', e.message);
            }
        }

        // Add to database with pending status
        // Assign to specific user if provided via user-specific route, else admin (ID=1)
        const userId = req.seerrcatalogUserId || 1;
        const media = db.addMedia({
            user_id: userId,
            type: 'series',
            tmdb_id: body.tmdbId,
            imdb_id: body.imdbId,
            tvdb_id: body.tvdbId,
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

        // Add seasons/episodes if provided
        if (body.seasons) {
            body.seasons.forEach(season => {
                // We don't have episode details from Seerr, just create placeholder
                if (season.monitored) {
                    for (let ep = 1; ep <= (season.statistics?.totalEpisodeCount || 10); ep++) {
                        db.addEpisode({
                            media_id: media.id,
                            season_number: season.seasonNumber,
                            episode_number: ep,
                            monitored: true
                        });
                    }
                }
            });
        }

        console.log('[Sonarr] Series added:', media.id, media.title);

        // Trigger async stream check (don't wait for response)
        setImmediate(async () => {
            try {
                const result = await checkStreamsAvailable(media, db);
                db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
                if (result.available) {
                    console.log(`[Sonarr] ✅ Streams found for: ${media.title} (${result.streamCount} streams)`);
                } else {
                    console.log(`[Sonarr] ⚠️ No streams found for: ${media.title}`);
                }
            } catch (e) {
                console.error('[Sonarr] Stream check error:', e.message);
            }
        });

        const episodes = db.getEpisodes(media.id);
        res.status(201).json(toSonarrSeries(media, episodes));
    } catch (e) {
        console.error('[Sonarr] Add series failed:', e);
        res.status(500).json({ message: e.message, stack: e.stack });
    }
});

// Update series
router.put('/api/v3/series/:id', (req, res) => {
    const media = db.getMediaById(parseInt(req.params.id));
    if (!media || media.type !== 'series') {
        return res.status(404).json({ message: 'Series not found' });
    }
    const episodes = db.getEpisodes(media.id);
    res.json(toSonarrSeries(media, episodes));
});

// Delete series
router.delete('/api/v3/series/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const media = db.getMediaById(id);

    if (!media || media.type !== 'series') {
        return res.status(404).json({ message: 'Series not found' });
    }

    db.deleteMedia(id);
    console.log('[Sonarr] Series deleted:', id, media.title);

    res.status(200).json({});
});

// Episodes
router.get('/api/v3/episode', (req, res) => {
    const { seriesId } = req.query;

    if (!seriesId) {
        return res.json([]);
    }

    const media = db.getMediaById(parseInt(seriesId));
    if (!media || media.type !== 'series') {
        return res.json([]);
    }

    const episodes = db.getEpisodes(media.id);
    res.json(episodes.map(ep => ({
        id: ep.id,
        seriesId: media.id,
        tvdbId: 0,
        episodeFileId: media.status === 'downloaded' ? ep.id : 0,
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        title: ep.title || `Episode ${ep.episode_number}`,
        airDate: ep.air_date,
        airDateUtc: ep.air_date,
        overview: ep.overview || '',
        hasFile: media.status === 'downloaded',
        monitored: !!ep.monitored,
        absoluteEpisodeNumber: ep.episode_number,
        unverifiedSceneNumbering: false,
        series: toSonarrSeries(media, episodes)
    })));
});

// Command endpoint
router.post('/api/v3/command', (req, res) => {
    const { name } = req.body;
    console.log('[Sonarr] Command received:', name);

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

// Queue
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
