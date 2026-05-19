# SeerrCatalog

Bridge between Jellyseerr and Stremio. Your Jellyseerr requests become a personal streaming catalog — no downloads, no storage.

> 🇫🇷 [Version française](README.md)

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![Build](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml)
[![Multi-arch](https://img.shields.io/badge/multi--arch-amd64%20%7C%20arm64-success?logo=docker&logoColor=white)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![i18n](https://img.shields.io/badge/i18n-FR%20%7C%20EN-blue)](#)
[![Stremio addon](https://img.shields.io/badge/Stremio-addon-8A5AAB?logo=stremio&logoColor=white)](https://www.stremio.com/)
[![Jellyseerr](https://img.shields.io/badge/Jellyseerr-compatible-6366f1)](https://github.com/Fallenbagel/jellyseerr)
[![Latest release](https://img.shields.io/github/v/release/Aerya/Stremio-Seerr-Catalog?display_name=tag&sort=semver)](https://github.com/Aerya/Stremio-Seerr-Catalog/releases)

> **Using it? Liking it? [⭐ Drop a star!](https://github.com/Aerya/Stremio-Seerr-Catalog/stargazers)** — takes two seconds.

## Features

- 🆕 NEW 🗑️ **Auto-Cleanup (watched 90% sync)** — syncs watch progress from your Stremio account. Anything watched at ≥90% is marked as seen and removed from your catalog. Runs every 24h or on demand, per-user toggle.
- 🔗 **Jellyfin / Radarr / Sonarr API emulation** — seamless Jellyseerr integration.
- 📺 **Personal Stremio catalog** — access requested content directly in Stremio.
- 🔍 **Smart stream search** — matches releases to your tags via addons linked to your Stremio account.
- 🌍 **Language & resolution filters** — only mark content as available if it matches your prefs (FRENCH, MULTI, 4K, 1080p…).
- 🔔 **Discord notifications** — alerts when no source is found (multi-webhook, FR/EN).
- 🔄 **24h auto-retry** — re-searches daily if nothing matched.
- 👥 **Multi-user** — each user has their own addons, filters, and catalog.
- 🔔 **Jellyseerr auto-sync** — request status flips to "Available" automatically.
- 🎨 **Modern WebUI** — dark mode, responsive, FR/EN.

## Quick start

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    environment:
      - BASE_URL=http://localhost:7000   # public URL if behind a reverse proxy
      - API_KEY=
      - PORT=7000
      - HOST=0.0.0.0
      - TMDB_API_KEY=
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

```bash
docker compose up -d
```

Then:
1. Open `http://localhost:7000` and create your admin account.
2. Add your Stremio auth key in Settings.
3. Configure Jellyseerr to use SeerrCatalog as its Jellyfin server.
4. Install the Stremio addon from the WebUI.
5. Enable **Auto-Cleanup** in your user settings.

### Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `7000` |
| `HOST` | Server host | `0.0.0.0` |
| `TMDB_API_KEY` | TMDB API key for metadata | — |
| `BASE_URL` | Public URL (reverse proxy) | auto-detected |
| `API_KEY` | API key exposed to clients | — |

## Notes

- **First run**: the initial Stremio sync can take a few minutes while it scans your library.
- **Reverse proxy**: set `BASE_URL` to your public URL, otherwise generated addon links will point to localhost.

## Credits

Built by [Aerya](https://github.com/Aerya) — [UpAndClear](https://upandclear.org).
[Article + screenshots](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/).

## License

MIT — see [LICENSE](LICENSE).
