/**
 * Localization strings for SeerrCatalog
 */
const translations = {
    en: {
        // Navigation
        nav_catalog: 'Catalog',
        nav_users: 'Users',
        nav_settings: 'Settings',

        // Catalog
        search_placeholder: 'Search movies & series...',
        search_type_all: 'All',
        search_type_movies: 'Movies',
        search_type_series: 'Series',
        filter_all: 'All',
        filter_available: 'Available',
        filter_unavailable: 'No Source',
        all_users: 'All Users',
        empty_catalog: 'No media in catalog',
        empty_hint: 'Content is synced from Overseerr/Jellyseerr',
        no_results: 'No results found',

        // Media card
        streams_found: '{count} streams',
        check_streams: 'Check Sources in Stremio',
        delete: 'Delete',
        cancel: 'Cancel',

        // Users
        user_management: 'User Management',
        add_user: 'Add User',
        username: 'Username',
        password: 'Password',
        display_name: 'Display Name',
        admin: 'Admin',
        create: 'Create',
        delete_user_confirm: 'Delete this user?',
        no_users: 'No users',

        // Settings
        settings_title: 'Settings',

        // TMDB
        tmdb_config: 'TMDB Configuration',
        tmdb_key: 'TMDB API Key',
        tmdb_key_hint: 'Get your free key at',
        tmdb_save: 'Save',
        tmdb_saved: 'Saved!',
        tmdb_configured: 'Configured',
        tmdb_not_configured: 'Not configured',

        // Language
        language: 'Language',

        // Stats
        movies: 'Movies',
        movie: 'Movie',
        series: 'TV Shows',
        serie: 'TV Show',
        available: 'Available',
        available_singular: 'Available',
        jellyfin_auth: 'Auth',

        // Stremio
        stremio_config: 'Stremio Configuration',
        stremio_email: 'Stremio Email',
        stremio_password: 'Stremio Password',
        stremio_not_configured: 'Not configured',
        stremio_login_failed: 'Login failed',
        stremio_disconnect_confirm: 'Disconnect Stremio account?',
        connect: 'Connect',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        connected: 'Connected',
        user: 'User',

        // Jellyseerr Configuration
        seerr_jellyseerr_config: 'Jellyseerr Configuration',
        seerr_config_hint: 'Copy these values when adding Radarr or Sonarr servers in Jellyseerr Settings → Services:',
        seerr_config_tip: 'In Jellyseerr, go to Settings → Services → Add Radarr/Sonarr Server and paste these values.',
        config_hostname: 'Hostname/IP:',
        config_port: 'Port:',
        config_ssl: 'SSL:',
        config_url_base: 'URL Base:',
        config_api_key: 'API Key:',
        config_movies: 'Movies',
        config_series: 'Series',
        seerr_per_user_hint: 'For per-user catalogs, use the URLs in the Users page instead.',

        // Jellyseerr Integration
        jellyseerr_integration: 'Jellyseerr Integration',
        jellyseerr_url: 'Jellyseerr URL',
        jellyseerr_url_hint: 'URL of your Jellyseerr instance (for auto-sync when streams are found)',
        jellyseerr_api_key: 'Jellyseerr API Key (optional)',
        jellyseerr_api_key_hint: 'Required only if your Jellyseerr API is protected',
        jellyseerr_test_connection: 'Test Connection',
        jellyseerr_auto_sync_info: 'Jellyseerr automatically checks Radarr/Sonarr every 5 minutes. When SeerrCatalog finds streams, Jellyseerr will detect the change within 5 minutes and send notifications.',

        // Stream Filters
        stream_filters: 'Stream Filters',
        language_tags: 'Language Tags (max 2):',
        min_resolution: 'Min Resolution:',
        auto_cleanup: 'Auto-cleanup watched content',

        // Discord Notifications
        discord_notifications: 'Discord Notifications',
        discord_webhooks: 'Discord Webhooks',
        discord_webhooks_hint: 'Get notified on Discord when no source is found for a media.',
        discord_settings: 'Notification Settings',
        discord_enabled: 'Enabled',
        discord_language: 'Language:',
        add: 'Add',

        // Modal
        sources_found: 'Sources found:',
        no_sources_found: 'No sources found during last check',
        files: 'files'
    },

    fr: {
        // Navigation
        nav_catalog: 'Catalogue',
        nav_users: 'Utilisateurs',
        nav_settings: 'Paramètres',

        // Catalog
        search_placeholder: 'Rechercher films et séries...',
        search_type_all: 'Tout',
        search_type_movies: 'Films',
        search_type_series: 'Séries',
        filter_all: 'Tout',
        filter_available: 'Disponible',
        filter_unavailable: 'Sans source',
        all_users: 'Tous les utilisateurs',
        empty_catalog: 'Aucun média dans le catalogue',
        empty_hint: 'Le contenu est synchronisé depuis Overseerr/Jellyseerr',
        no_results: 'Aucun résultat',

        // Media card
        streams_found: '{count} sources',
        check_streams: 'Vérifier les sources dans Stremio',
        delete: 'Supprimer',
        cancel: 'Annuler',

        // Users
        user_management: 'Gestion des utilisateurs',
        add_user: 'Ajouter',
        username: "Nom d'utilisateur",
        password: 'Mot de passe',
        display_name: "Nom d'affichage",
        admin: 'Admin',
        create: 'Créer',
        delete_user_confirm: 'Supprimer cet utilisateur ?',
        no_users: 'Aucun utilisateur',

        // Settings
        settings_title: 'Paramètres',

        // TMDB
        tmdb_config: 'Configuration TMDB',
        tmdb_key: 'Clé API TMDB',
        tmdb_key_hint: 'Obtenez votre clé gratuite sur',
        tmdb_save: 'Enregistrer',
        tmdb_saved: 'Enregistré !',
        tmdb_configured: 'Configurée',
        tmdb_not_configured: 'Non configuré',

        // Language
        language: 'Langue',

        // Stats
        movies: 'Films',
        movie: 'Film',
        series: 'Séries',
        serie: 'Série',
        available: 'Disponibles',
        available_singular: 'Disponible',
        jellyfin_auth: 'Auth',

        // Stremio
        stremio_config: 'Configuration Stremio',
        stremio_email: 'Email Stremio',
        stremio_password: 'Mot de passe Stremio',
        stremio_not_configured: 'Non configuré',
        stremio_login_failed: 'Échec de connexion',
        stremio_disconnect_confirm: 'Déconnecter le compte Stremio ?',
        connect: 'Connecter',
        reconnect: 'Reconnecter',
        disconnect: 'Déconnecter',
        connected: 'Connecté',
        user: 'Utilisateur',

        // Jellyseerr Configuration
        seerr_jellyseerr_config: 'Configuration Jellyseerr',
        seerr_config_hint: 'Copiez ces valeurs lors de l\'ajout de serveurs Radarr ou Sonarr dans Jellyseerr Paramètres → Services :',
        seerr_config_tip: 'Dans Jellyseerr, allez dans Paramètres → Services → Ajouter un serveur Radarr/Sonarr et collez ces valeurs.',
        config_hostname: 'Nom d\'hôte/IP :',
        config_port: 'Port :',
        config_ssl: 'SSL :',
        config_url_base: 'Base URL :',
        config_api_key: 'Clé API :',
        config_movies: 'Films',
        config_series: 'Séries',
        seerr_per_user_hint: 'Pour des catalogues par utilisateur, utilisez les URLs de la page Utilisateurs.',

        // Jellyseerr Integration
        jellyseerr_integration: 'Intégration Jellyseerr',
        jellyseerr_url: 'URL Jellyseerr',
        jellyseerr_url_hint: 'URL de votre instance Jellyseerr (pour synchronisation auto quand des sources sont trouvées)',
        jellyseerr_api_key: 'Clé API Jellyseerr (optionnelle)',
        jellyseerr_api_key_hint: 'Requis uniquement si votre API Jellyseerr est protégée',
        jellyseerr_test_connection: 'Tester la connexion',
        jellyseerr_auto_sync_info: 'ℹ️ Synchronisation automatique : Jellyseerr vérifie Radarr/Sonarr toutes les 5 minutes. Lorsque SeerrCatalog trouve des sources, Jellyseerr détectera le changement dans les 5 minutes et enverra les notifications.',

        // Stream Filters
        stream_filters: 'Filtres de sources',
        language_tags: 'Tags de langue (max 2) :',
        min_resolution: 'Résolution minimale :',
        auto_cleanup: 'Nettoyage auto du contenu regardé',

        // Discord Notifications
        discord_notifications: 'Notifications Discord',
        discord_webhooks: 'Webhooks Discord',
        discord_webhooks_hint: 'Recevez une notification Discord quand aucune source n\'est trouvée pour un média.',
        discord_settings: 'Paramètres de notification',
        discord_enabled: 'Activé',
        discord_language: 'Langue :',
        add: 'Ajouter',

        // Modal
        sources_found: 'Sources trouvées :',
        no_sources_found: 'Aucune source trouvée lors de la dernière vérification',
        files: 'fichiers'
    }
};

// Export for Node.js
if (typeof module !== 'undefined') {
    module.exports = { translations };
}
