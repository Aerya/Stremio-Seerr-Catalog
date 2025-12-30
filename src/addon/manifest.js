const manifest = {
    id: 'community.seerrcatalog',
    version: '1.1.0',
    name: 'Seerr Catalog',
    description: 'Catalog of media requested through Seerr with availability tracking',
    logo: 'https://raw.githubusercontent.com/seerr-team/seerr/develop/public/logo_full.svg',

    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],

    idPrefixes: ['tt', 'tmdb:'],

    catalogs: [
        // Main catalogs
        {
            id: 'seerr-movies',
            type: 'movie',
            name: 'Seerr Movies',
            extra: [
                { name: 'skip', isRequired: false },
                { name: 'genre', isRequired: false },
                { name: 'search', isRequired: false }
            ]
        },
        {
            id: 'seerr-series',
            type: 'series',
            name: 'Seerr Series',
            extra: [
                { name: 'skip', isRequired: false },
                { name: 'genre', isRequired: false },
                { name: 'search', isRequired: false }
            ]
        },
        // Availability-filtered catalogs
        {
            id: 'seerr-available',
            type: 'movie',
            name: '✅ Available',
            extra: [{ name: 'skip', isRequired: false }]
        },
        {
            id: 'seerr-available-series',
            type: 'series',
            name: '✅ Available',
            extra: [{ name: 'skip', isRequired: false }]
        },
        {
            id: 'seerr-unavailable',
            type: 'movie',
            name: '⚠️ No Sources',
            extra: [{ name: 'skip', isRequired: false }]
        },
        {
            id: 'seerr-unavailable-series',
            type: 'series',
            name: '⚠️ No Sources',
            extra: [{ name: 'skip', isRequired: false }]
        },
        // Watched catalogs
        {
            id: 'seerr-watched',
            type: 'movie',
            name: '👁️ Watched',
            extra: [{ name: 'skip', isRequired: false }]
        },
        {
            id: 'seerr-watched-series',
            type: 'series',
            name: '👁️ Watched',
            extra: [{ name: 'skip', isRequired: false }]
        }
    ],

    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

function getManifest(baseUrl) {
    return {
        ...manifest,
        ...(baseUrl && { contactEmail: `admin@${new URL(baseUrl).hostname}` })
    };
}

module.exports = { manifest, getManifest };
