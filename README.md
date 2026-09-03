# SeerrCatalog

Passerelle entre Jellyseerr et Stremio. Tes requêtes Jellyseerr deviennent un catalogue de streaming personnel — sans téléchargement, sans stockage.

> 🇬🇧 [English version](README.en.md)

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![Build](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml)
[![Multi-arch](https://img.shields.io/badge/multi--arch-amd64%20%7C%20arm64-success?logo=docker&logoColor=white)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![i18n](https://img.shields.io/badge/i18n-FR%20%7C%20EN-blue)](#)
[![Stremio addon](https://img.shields.io/badge/Stremio-addon-8A5AAB?logo=stremio&logoColor=white)](https://www.stremio.com/)
[![Jellyseerr](https://img.shields.io/badge/Jellyseerr-compatible-6366f1)](https://github.com/Fallenbagel/jellyseerr)

> **Tu l'utilises ? Tu l'aimes ? [⭐ Mets une étoile !](https://github.com/Aerya/Stremio-Seerr-Catalog/stargazers)** — ça prend deux secondes.

## Fonctionnalités

- 🆕 NEW 🗑️ **Nettoyage Auto (sync watched 90%)** — synchronise la progression depuis ton compte Stremio. Tout contenu visionné à ≥90% est marqué comme vu et retiré du catalogue. Sync toutes les 24h ou à la demande, activable par utilisateur.
- 🔗 **Émulation API Jellyfin / Radarr / Sonarr** — intégration transparente avec Jellyseerr.
- 📺 **Catalogue Stremio personnel** — accède à tes contenus demandés directement dans Stremio.
- 🔍 **Recherche intelligente** — releases avec tes tags, via les addons liés à ton compte Stremio **et/ou des manifests ajoutés directement** (AIOStreams, Lumio, StreamFusion, StreamNZB, LooStream, WaStream…).
- 🔌 **Addons directs** — colle une ou plusieurs URLs `manifest.json` par utilisateur ; la détection de disponibilité peut fonctionner sans compte Stremio.
- ✅ **Seuil de disponibilité** — choisis le nombre minimum de releases et d'addons distincts requis avant de déclarer un média disponible.
- 🌍 **Filtres langue & résolution** — ne marque comme dispo que ce qui colle à tes préférences (FRENCH, MULTI, 4K, 1080p…).
- 🔔 **Notifications Discord** — alerte quand aucune source n'est trouvée (multi-webhook, FR/EN).
- 🔄 **Retry auto 24h** — relance la recherche quotidiennement si rien ne matche.
- 👥 **Multi-utilisateurs** — addons, filtres et catalogue propres à chaque utilisateur.
- 🔔 **Sync auto Jellyseerr** — le statut bascule sur "Disponible" automatiquement.
- 🎨 **WebUI moderne** — dark mode, responsive, FR/EN.

## Démarrage rapide

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    environment:
      - BASE_URL=http://localhost:7000   # URL publique si reverse proxy
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

Ensuite :
1. Ouvre `http://localhost:7000` et crée ton compte admin.
2. Ajoute ta clé d'auth Stremio dans les Paramètres **ou** renseigne des manifests d'addons directs dans les filtres utilisateur. La clé Stremio reste nécessaire pour la synchro du statut regardé.
3. Configure Jellyseerr pour utiliser SeerrCatalog comme serveur Jellyfin.
4. Installe l'addon Stremio depuis la WebUI.
5. Active le **Nettoyage Auto** dans tes paramètres utilisateur.

### Variables

| Variable | Description | Défaut |
|---|---|---|
| `PORT` | Port du serveur | `7000` |
| `HOST` | Hôte du serveur | `0.0.0.0` |
| `TMDB_API_KEY` | Clé API TMDB pour les métadonnées | — |
| `BASE_URL` | URL publique (reverse proxy) | auto-détectée |
| `API_KEY` | Clé d'API exposée aux clients | — |

## Notes

- **Premier lancement** : la première synchro Stremio peut prendre quelques minutes le temps de scanner ta bibliothèque.
- **URLs de manifests** : certaines contiennent des jetons ou des identifiants de configuration. Garde-les privées ; SeerrCatalog les stocke dans sa base de paramètres.
- **Reverse proxy** : pense à fixer `BASE_URL` à ton URL publique, sinon les liens d'addon générés pointeront vers localhost.

## Crédits

Créé par [Aerya](https://github.com/Aerya) — [UpAndClear](https://upandclear.org).
[Article + captures d'écran](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/).

## Licence

MIT — voir [LICENSE](LICENSE).
