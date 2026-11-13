const manifest = {
    id: 'community.seerrcatalog',
    // Bump when advertised capabilities change; keep addon/catalog IDs stable.
    version: '1.2.0',
    name: 'Seerr Catalog',
    description: 'Catalog of media requested through Seerr with availability tracking',
    logo: 'https://raw.githubusercontent.com/seerr-team/seerr/develop/public/logo_full.svg',

    resources: ['catalog', 'meta', 'subtitles'],
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
