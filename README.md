# SeerrCatalog

> 🎬 Bridge between Jellyseerr and Stremio - Transform your media requests into a personal streaming catalog

[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://hub.docker.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

🇫🇷 **[Version Française](#-seerrcatalog-français)**

**[Article lié + screens](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/)**

**[Screen is this French written article](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/)**

---

## What is SeerrCatalog?

SeerrCatalog acts as a **virtual media server** that connects Jellyseerr to Stremio. When you request a movie or TV show through Jellyseerr, SeerrCatalog automatically checks if streams are available via your Stremio addons and adds them to your personal catalog.

**No downloads, no storage needed** - just request and stream!

## ✨ What's New

### 🗑️ Automatic Watched Sync & Cleanup
SeerrCatalog now syncs your watch progress directly from your Stremio account. Once you've watched **90% or more** of a movie or series, it is automatically marked as watched — and deleted from your catalog if **Auto-Cleanup** is enabled.

- Sync runs automatically every 24 hours
- Can be triggered manually from the WebUI
- Configurable per user — enable Auto-Cleanup in your user settings
- Works across all your devices (Stremio syncs progress to the cloud)

No more opening the WebUI to manually remove content you've already watched!

---

## Features

- 🔗 **Jellyfin/Radarr/Sonarr API Emulation** - Seamless Jellyseerr integration
- 📺 **Personal Stremio Catalog** - Access your requested content in Stremio
- 🔍 **Smart Stream Search** - Searches for releases matching your tags in addons linked to your Stremio account
- 🌍 **Language & Resolution Filters** - Only mark content as available if it matches your preferences (FRENCH, MULTI, 4K, 1080p...)
- 🔔 **Discord Notifications** - Get notified when no source is found (multi-webhook, FR/EN)
- 🔄 **24h Auto-Retry** - If no source matches your criteria, retries automatically every 24 hours
- 🗑️ **Auto-Cleanup** - Watched content (≥90%) is synced from Stremio and automatically removed from catalogs
- 👥 **Multi-User Support** - Each user has their own addons, filters, and catalog
- 🔔 **Auto-Sync with Jellyseerr** - Media status updates automatically to "Available"
- 🎨 **Modern WebUI** - Dark mode, responsive design, FR/EN localization

## Quick Start

```bash
git clone https://github.com/Aerya/SeerrCatalog.git
cd SeerrCatalog
cp .env.example .env
docker-compose up -d
```

Or just fill this compose with your data:
```bash
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    environment:
    # set your URL if using a reverse proxy
      - BASE_URL=http://localhost:7000
      - API_KEY=
      - PORT=7000
      - HOST=0.0.0.0
      - TMDB_API_KEY=
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

Then:
1. Open `http://localhost:7000` and create your admin account
2. Add your Stremio auth key in Settings
3. Configure Jellyseerr to use SeerrCatalog as its Jellyfin server
4. Install the Stremio addon from the WebUI
5. Enable **Auto-Cleanup** in your user settings to automatically remove watched content

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `7000` |
| `HOST` | Server host | `0.0.0.0` |
| `TMDB_API_KEY` | TMDB API key for metadata | - |
| `BASE_URL` | Public URL (for reverse proxy) | auto-detected |


---

# 🇫🇷 SeerrCatalog (Français)

> 🎬 Passerelle entre Jellyseerr et Stremio - Transformez vos requêtes (Disponibles) en catalogue de streaming personnel

## Qu'est-ce que SeerrCatalog ?

SeerrCatalog agit comme un **serveur multimédia virtuel** qui connecte Jellyseerr à Stremio. Quand vous demandez un film ou une série via Jellyseerr, SeerrCatalog vérifie automatiquement si des streams sont disponibles via vos addons Stremio et les ajoute à votre catalogue personnel.

**Pas de téléchargement, pas de stockage** - demandez et streamez !

## ✨ Nouveauté

### 🗑️ Synchronisation automatique de l'historique de visionnage
SeerrCatalog synchronise désormais votre progression de visionnage directement depuis votre compte Stremio. Dès que vous avez regardé **90% ou plus** d'un film ou d'une série, il est automatiquement marqué comme visionné — et supprimé de votre catalogue si le **Nettoyage Auto** est activé.

- La synchronisation s'exécute automatiquement toutes les 24 heures
- Peut être déclenchée manuellement depuis la WebUI
- Configurable par utilisateur — activez le Nettoyage Auto dans vos paramètres utilisateur
- Fonctionne sur tous vos appareils (Stremio synchronise la progression dans le cloud)

Plus besoin d'ouvrir la WebUI pour supprimer manuellement les contenus déjà visionnés !

---

## Fonctionnalités

- 🔗 **Émulation API Jellyfin/Radarr/Sonarr** - Intégration transparente avec Jellyseerr
- 📺 **Catalogue Stremio Personnel** - Accédez à vos contenus demandés dans Stremio
- 🔍 **Recherche Intelligente** - Recherche les releases avec vos tags dans les addons liés à votre compte Stremio
- 🌍 **Filtres Langue & Résolution** - Ne marque comme disponible que si ça correspond à vos préférences (FRENCH, MULTI, 4K, 1080p...)
- 🔔 **Notifications Discord** - Soyez notifié quand aucune source n'est trouvée (multi-webhook, FR/EN)
- 🔄 **Retry Auto 24h** - Si aucune source ne correspond à vos critères, relance automatiquement toutes les 24 heures
- 🗑️ **Nettoyage Auto** - Les contenus visionnés (≥90%) sont synchronisés depuis Stremio et automatiquement retirés des catalogues
- 👥 **Multi-Utilisateurs** - Chaque utilisateur a ses propres addons, filtres et catalogue
- 🔔 **Sync Auto avec Jellyseerr** - Le statut passe automatiquement à "Disponible"
- 🎨 **WebUI Moderne** - Mode sombre, responsive, localisation FR/EN

## Démarrage Rapide

```bash
git clone https://github.com/Aerya/SeerrCatalog.git
cd SeerrCatalog
cp .env.example .env
docker-compose up -d
```
Ou utilisez ce compose avec vos données :
```bash
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    environment:
    # mettre l'URL si vous utilisez un reverse proxy
      - BASE_URL=http://localhost:7000
      - API_KEY=
      - PORT=7000
      - HOST=0.0.0.0
      - TMDB_API_KEY=
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

Ensuite :
1. Ouvrez `http://localhost:7000` et créez votre compte admin
2. Ajoutez votre clé Stremio dans les Paramètres
3. Configurez Jellyseerr pour utiliser SeerrCatalog comme serveur Jellyfin
4. Installez l'addon Stremio depuis la WebUI
5. Activez le **Nettoyage Auto** dans vos paramètres utilisateur pour supprimer automatiquement les contenus visionnés

## Configuration

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `7000` |
| `HOST` | Hôte du serveur | `0.0.0.0` |
| `TMDB_API_KEY` | Clé API TMDB pour les métadonnées | - |
| `BASE_URL` | URL publique (pour reverse proxy) | auto-détectée |

---

## License

MIT License - See [LICENSE](LICENSE) for details.

## Credits

Created by [Aerya](https://github.com/Aerya) | [UpAndClear](https://upandclear.org)
