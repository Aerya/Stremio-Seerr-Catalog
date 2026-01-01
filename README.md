# SeerrCatalog

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/stremio.webp" width="80" alt="Stremio">
  <img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/jellyseerr.webp" width="80" alt="Jellyseerr">
</p>

<p align="center">
  <strong>A Stremio addon that syncs your Jellyseerr/Overseerr requests</strong>
</p>

<p align="center">
  <a href="#-version-française">🇫🇷 Version Française</a>
</p>

---

## 🇬🇧 English

### What is SeerrCatalog?

SeerrCatalog is a self-hosted Stremio addon that creates a personal catalog from your Jellyseerr/Overseerr media requests. It acts as an emulated Radarr/Sonarr server, so when you request a movie or TV show in Jellyseerr, it automatically appears in your Stremio catalog.

### ✨ Features

- **Jellyseerr Integration** — Emulates Radarr/Sonarr APIs so Jellyseerr can send requests directly
- **Multi-User Support** — Each user gets their own catalog, Radarr/Sonarr endpoints, and Stremio manifest
- **Stream Detection** — Automatically checks if streams are available via user's Stremio addons
- **TMDB Integration** — Fetches posters, descriptions, and metadata from TMDB
- **WebUI** — Modern interface to manage your catalog, users, and settings
- **Bilingual** — Full French/English support (🇫🇷/🇬🇧)

### 📋 Requirements

- Docker & Docker Compose
- Jellyseerr or Overseerr instance
- TMDB API key (free at [themoviedb.org](https://www.themoviedb.org/settings/api))

### 🚀 Quick Start

1. Create a `docker-compose.yml`:

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    env_file:
      - .env
    environment:
      - BASE_URL=${BASE_URL}
      - ADDON_USER=${ADDON_USER}
      - ADDON_PASSWORD=${ADDON_PASSWORD}
      - API_KEY=${API_KEY}
      - PORT=${PORT}
      - HOST=${HOST}
      - TMDB_API_KEY=${TMDB_API_KEY}
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

2. Start the container:
```bash
docker-compose up -d
```

3. Access the WebUI at `http://YOUR_IP:7000`

4. Configure your TMDB API key in Settings

5. In Jellyseerr, add a Radarr/Sonarr server with:
   - **Hostname:** `YOUR_IP`
   - **Port:** `7000`
   - **URL Base:** `/user/1/radarr` (for Radarr) or `/user/1/sonarr` (for Sonarr)
   - **API Key:** `seerrcatalog-api-key`

6. Install your personal Stremio addon from the Users page

### 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `7000` |
| `HOST` | Bind address | `0.0.0.0` |
| `BASE_URL` | Public URL of the addon | Required |
| `ADDON_USER` | WebUI username | Required |
| `ADDON_PASSWORD` | WebUI password | Required |
| `API_KEY` | API key for Radarr/Sonarr endpoints | `seerrcatalog-api-key` |

### 📁 Data Persistence

All data is stored in SQLite at `/app/data/seerrcatalog.db`. Mount this directory to persist your catalog.

---

## 🇫🇷 Version Française

### Qu'est-ce que SeerrCatalog ?

SeerrCatalog est un addon Stremio auto-hébergé qui crée un catalogue personnel à partir de vos demandes Jellyseerr/Overseerr. Il émule les API Radarr/Sonarr, donc quand vous faites une demande de film ou série dans Jellyseerr, elle apparaît automatiquement dans votre catalogue Stremio.

### ✨ Fonctionnalités

- **Intégration Jellyseerr** — Émule les API Radarr/Sonarr pour recevoir les demandes directement
- **Multi-Utilisateurs** — Chaque utilisateur a son propre catalogue, endpoints Radarr/Sonarr et manifest Stremio
- **Détection de Sources** — Vérifie automatiquement si des sources sont disponibles via les addons Stremio de l'utilisateur
- **Intégration TMDB** — Récupère les affiches, descriptions et métadonnées depuis TMDB
- **Interface Web** — Interface moderne pour gérer votre catalogue, utilisateurs et paramètres
- **Bilingue** — Support complet Français/Anglais (🇫🇷/🇬🇧)

### 📋 Prérequis

- Docker & Docker Compose
- Instance Jellyseerr ou Overseerr
- Clé API TMDB (gratuite sur [themoviedb.org](https://www.themoviedb.org/settings/api))

### 🚀 Démarrage Rapide

1. Créez un fichier `docker-compose.yml` :

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    env_file:
      - .env
    environment:
      - BASE_URL=${BASE_URL}
      - ADDON_USER=${ADDON_USER}
      - ADDON_PASSWORD=${ADDON_PASSWORD}
      - API_KEY=${API_KEY}
      - PORT=${PORT}
      - HOST=${HOST}
      - TMDB_API_KEY=${TMDB_API_KEY}
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

2. Lancez le conteneur :
```bash
docker-compose up -d
```

3. Accédez à l'interface sur `http://VOTRE_IP:7000`

4. Configurez votre clé API TMDB dans les Paramètres

5. Dans Jellyseerr, ajoutez un serveur Radarr/Sonarr avec :
   - **Hostname :** `VOTRE_IP`
   - **Port :** `7000`
   - **URL Base :** `/user/1/radarr` (pour Radarr) ou `/user/1/sonarr` (pour Sonarr)
   - **API Key :** `seerrcatalog-api-key`

6. Installez votre addon Stremio personnel depuis la page Utilisateurs

### 🔧 Variables d'Environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `7000` |
| `HOST` | Adresse d'écoute | `0.0.0.0` |
| `BASE_URL` | URL publique de l'addon | Requis |
| `ADDON_USER` | Nom d'utilisateur WebUI | Requis |
| `ADDON_PASSWORD` | Mot de passe WebUI | Requis |
| `API_KEY` | Clé API pour les endpoints Radarr/Sonarr | `seerrcatalog-api-key` |

### 📁 Persistance des Données

Toutes les données sont stockées dans SQLite à `/app/data/seerrcatalog.db`. Montez ce répertoire pour persister votre catalogue.

---

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

## 🙏 Credits

Made with ❤️ by [Aerya](https://github.com/Aerya) | [Blog](https://upandclear.org) | [Ko-fi](https://ko-fi.com/upandclear)
