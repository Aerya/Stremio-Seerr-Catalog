# SeerrCatalog

**Passerelle entre Jellyseerr et Stremio pour transformer les demandes de médias en catalogue personnel, sans téléchargement ni stockage de médias par SeerrCatalog.**

[English](README.en.md)

[![Build](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/Aerya/Stremio-Seerr-Catalog/actions/workflows/docker-publish.yml)
[![GHCR](https://img.shields.io/badge/GHCR-latest-24292f)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-555)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![Languages](https://img.shields.io/badge/WebUI-FR%20%7C%20EN-555)](README.en.md)
[![License](https://img.shields.io/github/license/Aerya/Stremio-Seerr-Catalog)](LICENSE)

SeerrCatalog se place entre Jellyseerr, Stremio et tes sources de streaming. Il expose les demandes Jellyseerr via une API compatible Jellyfin / Radarr / Sonarr, construit un catalogue Stremio personnel et contrôle la disponibilité réelle des médias avant de les déclarer disponibles.

## Fonctionnement

```text
Jellyseerr
    |
    v
SeerrCatalog
    |
    +-- Catalogue Stremio personnel
    |
    +-- Vérification des releases
            |
            +-- Addons du compte Stremio
            +-- Addons supplémentaires (manifest.json)
                    |
                    v
            Filtres langue / résolution
                    |
                    v
            Seuil releases + seuil addons distincts
                    |
                    v
            Disponible / Sans source
```

Les addons supplémentaires ne remplacent pas les addons du compte Stremio : **ils s'y ajoutent**.

Exemple : si le compte Stremio utilise AIOStreams et que Lumio, StreamFusion et StreamNZB sont ajoutés manuellement, SeerrCatalog interroge l'ensemble de ces sources.

Sans compte Stremio lié, les manifests ajoutés manuellement peuvent également être utilisés seuls pour la vérification de disponibilité. Le compte Stremio reste nécessaire aux fonctions qui dépendent du compte, notamment la synchronisation de l'état regardé.

## Fonctionnalités

| Fonction | Description |
|---|---|
| Catalogue Stremio | Les demandes Jellyseerr deviennent un catalogue personnel accessible depuis Stremio. |
| Compatibilité Jellyseerr | Émulation des API Jellyfin, Radarr et Sonarr utilisées par Jellyseerr. |
| Addons du compte Stremio | Les addons disposant d'une ressource `stream` sont récupérés automatiquement depuis le compte lié. |
| Addons supplémentaires | Ajout d'URLs `manifest.json` compatibles avec le protocole Stremio. |
| Compatibilité addons | Fonctionne notamment avec AIOStreams, Lumio, StreamFusion, StreamNZB, LooStream et WaStream. |
| Filtres | Filtrage par tags de langue et résolution minimale. |
| Disponibilité configurable | Nombre minimum de releases et nombre minimum d'addons distincts configurables par utilisateur. |
| Multi-utilisateurs | Catalogue, sources, filtres et règles de disponibilité propres à chaque utilisateur. |
| Retry automatique | Nouvelle vérification quotidienne des médias sans source. |
| Synchronisation regardé | Les contenus regardés à au moins 90 % peuvent être automatiquement nettoyés du catalogue. |
| Notifications Discord | Notification lorsqu'aucune source correspondante n'est trouvée. |
| WebUI | Interface responsive en français et en anglais. |

## Règles de disponibilité

Deux valeurs indépendantes déterminent quand un média est considéré comme disponible :

- **Releases minimum** : nombre total de releases correspondant aux filtres.
- **Addons distincts minimum** : nombre de sources différentes devant retourner au moins une release.

| Releases minimum | Addons minimum | Exemple de règle |
|---:|---:|---|
| 1 | 1 | Au moins une release sur une source. |
| 2 | 1 | Au moins deux releases, même depuis un seul addon. |
| 1 | 2 | Au moins deux addons différents doivent trouver une release. |
| 3 | 2 | Au moins trois releases au total, provenant d'au moins deux addons. |

Par défaut, les deux valeurs sont à `1`, ce qui conserve le comportement historique.

## Installation

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    container_name: seerr-catalog
    ports:
      - "7000:7000"
    environment:
      - BASE_URL=http://localhost:7000
      - API_KEY=
      - PORT=7000
      - HOST=0.0.0.0
      - TMDB_API_KEY=
    volumes:
      - /mnt/Docker/stremio/seerrcatalog:/app/data
    restart: always
```

Démarrage :

```bash
docker compose up -d
```

## Configuration

1. Ouvre `http://localhost:7000`.
2. Crée le compte administrateur.
3. Configure la clé TMDB.
4. Lie un compte Stremio si tu veux utiliser automatiquement ses addons et la synchronisation de lecture.
5. Dans **Utilisateurs > Sources et filtres**, configure si nécessaire les addons supplémentaires, les filtres et les seuils de disponibilité.
6. Configure Jellyseerr avec les informations Radarr / Sonarr affichées par SeerrCatalog.
7. Installe le manifest SeerrCatalog dans Stremio.

### Sources de recherche

Pour chaque utilisateur :

- les addons du compte Stremio connecté sont chargés automatiquement ;
- les manifests saisis dans **Addons supplémentaires** sont ajoutés au même pool ;
- un même transport Stremio n'est interrogé qu'une fois s'il apparaît dans les deux listes ;
- les filtres sont appliqués aux releases retournées ;
- les seuils de disponibilité sont évalués sur le résultat combiné.

Les URLs de manifests sont propres à chaque utilisateur.

## Variables d'environnement

| Variable | Description | Défaut |
|---|---|---|
| `PORT` | Port HTTP de SeerrCatalog | `7000` |
| `HOST` | Interface d'écoute | `0.0.0.0` |
| `TMDB_API_KEY` | Clé API TMDB utilisée pour les métadonnées | — |
| `BASE_URL` | URL publique, notamment derrière un reverse proxy | auto-détectée |
| `API_KEY` | Clé d'API exposée aux clients compatibles | — |

## Mise à jour

Avec Docker Compose :

```bash
docker compose pull
docker compose up -d --force-recreate
```

Un simple `docker compose restart` ne suffit pas après un `pull` : il redémarre le conteneur existant avec l'image sur laquelle il a été créé.

Avec Dockge / Dockge-Enhanced, utilise donc **Pull & Recreate** pour appliquer une nouvelle image.

## Sécurité

Certaines URLs `manifest.json` peuvent contenir des jetons, clés ou paramètres privés.

- Ne publie pas ces URLs.
- Protège le volume `/app/data`, qui contient les paramètres de l'application.
- Utilise HTTPS si l'instance est exposée derrière un reverse proxy.
- Fixe `BASE_URL` à l'URL publique lorsque SeerrCatalog est utilisé derrière un proxy.

## Documentation

Article et captures d'écran : [UpAndClear — SeerrCatalog, l'addon Over/Jelly/Seerr pour Stremio](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/)

Image Docker : [ghcr.io/aerya/stremio-seerr-catalog](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)

## Projet

Développé et maintenu par [Aerya](https://github.com/Aerya).

Site : [UpAndClear](https://upandclear.org/)

Si SeerrCatalog t'est utile, tu peux soutenir le projet en laissant une étoile sur GitHub.

## Licence

MIT — voir [LICENSE](LICENSE).
