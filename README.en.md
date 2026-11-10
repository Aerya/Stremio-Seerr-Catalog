# SeerrCatalog

[Version française](README.md)

**A bridge between Jellyseerr and Stremio that turns media requests into a personal catalog, without SeerrCatalog downloading or storing media files.**

[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-555)](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)
[![Languages](https://img.shields.io/badge/WebUI-FR%20%7C%20EN-555)](README.md)
[![License](https://img.shields.io/github/license/Aerya/Stremio-Seerr-Catalog)](LICENSE)

SeerrCatalog sits between Jellyseerr, Stremio and your streaming sources. It exposes Jellyseerr requests through Jellyfin / Radarr / Sonarr compatible APIs, builds a personal Stremio catalog and checks actual stream availability before marking media as available.

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Availability rules](#availability-rules)
- [Ether Remix integration](#ether-remix-integration)
- [Discord notifications](#discord-notifications)
- [Screenshots](#screenshots)
- [Environment variables](#environment-variables)
- [Updating](#updating)
- [Security](#security)
- [Documentation](#documentation)

## How it works

```text
Jellyseerr
    |
    v
SeerrCatalog
    |
    +-- Personal Stremio catalog
    |
    +-- Release availability check
            |
            +-- Stremio account addons
            +-- Additional addons (manifest.json)
                    |
                    v
            Language / resolution filters
                    |
                    v
            Release threshold + distinct addon threshold
                    |
                    v
            Available / No source
```

Additional addons do not replace the addons from the connected Stremio account: **they are added to them**.

For example, if the Stremio account uses AIOStreams and Lumio, StreamFusion and StreamNZB are added manually, SeerrCatalog queries all of those sources.

Without a connected Stremio account, manually configured manifests can also be used on their own for availability checks. A Stremio account is still required for account-dependent features such as watched-state synchronization.

## Features

| Feature | Description |
|---|---|
| Stremio catalog | Jellyseerr requests become a personal catalog available in Stremio. |
| Jellyseerr compatibility | Emulates the Jellyfin, Radarr and Sonarr APIs used by Jellyseerr. |
| Stremio account addons | Addons exposing a `stream` resource are automatically loaded from the connected account. |
| Additional addons | Add compatible Stremio `manifest.json` URLs manually. |
| Addon compatibility | Works with addons such as AIOStreams, Lumio, StreamFusion, StreamNZB, LooStream and WaStream. |
| Filters | Filter releases by language tags and minimum resolution. |
| Configurable availability | Set the minimum release count and minimum distinct addon count per user. |
| Multi-user | Catalog, sources, filters and availability rules are isolated per user. |
| Automatic retry | Media without sources is checked again daily. |
| Watched synchronization | Content watched at 90% or more can be automatically removed from the catalog. |
| Discord notifications | Sources found, confirmed missing sources and catalog removals. |
| WebUI | Responsive French and English interface. |
| Ether Remix (opt-in) | Secure export of recently checked availability and stream descriptors without another addon lookup. |

## Installation

### Docker user and existing volumes

The image now runs as `node` (UID/GID `1000:1000`). **Before updating an existing installation with root-owned data**, add `user: "0:0"` to the `seerr-catalog` service in your current Compose file. With the Compose file provided here, set `CONTAINER_USER=0:0` in `.env` instead. Keep your existing volume paths, environment variables and secrets. This compatibility mode retains root execution; the TLS fix still applies.

For a new installation, use an empty named volume mounted at `/app/data` (Docker initializes it with the image permissions), or prepare a bind directory writable by `1000:1000`. Existing custom users remain supported via `user: "UID:GID"`. No startup script changes ownership or permissions. Do not recursively change ownership of existing volumes. Plan the image replacement separately; updating these files alone does not migrate running containers.

```yaml
services:
  seerr-catalog:
    image: ghcr.io/aerya/stremio-seerr-catalog:latest
    user: "${CONTAINER_USER:-1000:1000}"
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

Start:

```bash
docker compose up -d
```

## Configuration

1. Open `http://localhost:7000`.
2. Create the administrator account.
3. Configure the TMDB key.
4. Connect a Stremio account if you want to automatically use its addons and watched synchronization.
5. Under **Users > Sources & filters**, configure additional addons, filters and availability thresholds when needed.
6. Configure Jellyseerr with the Radarr / Sonarr information displayed by SeerrCatalog.
7. Install the SeerrCatalog manifest in Stremio.

### Search sources

For each user:

- addons from the connected Stremio account are loaded automatically;
- manifests entered under **Additional addons** are added to the same pool;
- the same Stremio transport is queried only once if it appears in both lists;
- filters are applied to returned releases;
- availability thresholds are evaluated against the combined result.

Manifest URLs are stored per user.

### Connecting to Seerr / Jellyseerr

In settings, enter a Seerr URL reachable from the SeerrCatalog container (for example `http://seerr:5055` on a shared Docker network) and the key from Seerr’s **Settings > General**. Save, then run the connection test.

The test checks Seerr availability and, when a key is provided, access to its protected API. Without a key, only connectivity is checked. Your SeerrCatalog web session is separate from this API key.

## Availability rules

Automatic confirmation requires **at least two distinct releases** (default: two releases from one addon). Higher release/addon thresholds remain available. Previously configured thresholds of one become two for pending titles; already available titles stay confirmed. Identical torrent hash, filename or URL results count once.

- **Confirmed availability is permanent until deletion.** Background jobs, manual checks, Jellyfin reads, Remix and filter changes cannot revoke it. There is no search for a better version.
- **One release:** check again on **day 1 and day 3**, measured from the first single-release observation. SQLite persists deadlines across restarts. The scheduler wakes hourly; downtime can delay checks. Manual checks do not prematurely advance stages.
- After both checks still yield one release, send one review alert through Discord and/or Apprise, optionally mentioning a configured Discord user. Continue searching daily without repeating a successfully delivered alert.
- **Approve this release** in the title details confirms a single release permanently, immediately if desired. Zero releases cannot be approved.
- **Zero releases:** remain searching, checking daily indefinitely, without a final failure alert. Returning to zero resets the single-release timetable for its next discovery.
- The per-user **Configurable language fallback** reuses existing addon responses only when no primary-language release passes the language/resolution filters. One matching primary-language release prevents fallback. Each user can edit up to two fallback tags, prefilled with `VOSTFR` and `SUBFRENCH` as examples; leaving both empty disables fallback. New profiles default to `FRENCH` and `MULTI`; subtitles follow the same confirmation rules.
- Network/addon errors preserve previous results and do not trigger review alerts. They are retried on the next scheduler wake. Series checks cover monitored seasons (up to two recent seasons, then `S01E01`); availability does not guarantee every episode. Manifest caching lasts 60 seconds and stream concurrency is limited to four.

### Appearance

Choose **Day**, **Night** or **Auto** (system preference), with **Violet, Ocean, Forest, Rose or Amber** palettes. Preferences persist in this browser, including the login page. Slimmer buttons and aligned Jellyseerr/Discord panels adapt to mobile screens.

### Show only available content in Stremio

By default, the catalogue shows all requests, even without sources. Under **Users → Sources & filters → Availability criteria**, select **Show only available content in the personal Stremio catalog**, then **Save**. Install the personal addon URL `/user/<id>/manifest.json` from that user’s card; the global `/manifest.json` still shows all requests.

This filters movies, series and search results before pagination, using permanent automatic or manual confirmation. Unavailable and unchecked items are hidden without deleting requests or changing the Radarr/Sonarr-compatible APIs. Refresh Stremio to renew its cache; changing criteria does not revoke previously confirmed titles. Finding a source does not guarantee playback, and an available series does not mean every episode is available.

## Ether Remix integration

The integration is **disabled by default**. [Ether Remix](https://github.com/Aerya/Ether-Remix) can reuse results already retrieved by SeerrCatalog instead of querying the same addons again just to check catalogue availability.

1. Open **Settings → Ether Remix integration**, generate a shared token, and copy it into Remix.
2. Enable and save the export. This section displays the base address to copy into Remix, without an `/api/…` path. No Remix receiving endpoint is required.
3. Previously confirmed titles are exported automatically, without new searches or renewing old playback links.

In [Ether Remix](https://github.com/Aerya/Ether-Remix), open **Sources → Stremio → SeerrCatalog → Availability to Remix**, enter the SeerrCatalog base address and the same token, then enable and save. Remix synchronizes every minute and trusts SeerrCatalog availability criteria for these titles, including “playable only”. Other visibility rules and viewer playback policies remain in force.

Confirmed availability carries `availabilityConfirmed: true` and persists until deletion. **Update both SeerrCatalog and Ether Remix**; older Remix versions continue to expire observations after 26 hours. Playback URLs still expire after 30 minutes without removing catalogue availability.

The token accesses results for all users of this instance: connect only your trusted instances. Recent HTTP sources and torrent hashes are reused for playback; otherwise, or after failure, Remix falls back to ordinary discovery. Provider permissions, network access and restrictions must allow playback from Remix.

### Original-language releases with SubMaker subtitles via Remix

Disabled by default. Configure authenticated **Search via Remix** in **Settings → Ether Remix integration**. In [Remix](https://github.com/Aerya/Ether-Remix), configure public or self-hosted [SubMaker](https://github.com/xtremexq/StremioSubMaker) with a personal manifest, subtitle providers and translation engine. Under **Users → Sources & filters**, enable external subtitles and select the same target language as Remix (`fr` by default). Availability sharing remains independent.

When no primary-language release exists, Remix can find target-language SRTs or translate English SRTs (languages are configurable). Only complete files matching the release filename are accepted. Translations must retain cue counts and timestamps; linguistic quality and actual synchronization still need playback verification. Pending or failed translations do not confirm availability. Pending jobs are checked again after five minutes.

Two distinct qualifying releases with checked subtitles can confirm availability; one retains J+1/J+3 retries and manual approval. Resolution and addon-count criteria remain enforced. The badge identifies the subtitle language and AI translation. Primary-language-only searches exclude this fallback. Confirmed availability remains permanent until deletion.

The manifest now exposes `subtitles`; reinstall the addon if the client caches its old resource list. The player must send the matching video `filename` to retrieve the stored SRT. Without it, no subtitle is served. Deleting the media removes subtitle access. Remix retains the private SubMaker manifest; only the SRT result is sent through authenticated search.

[Remix setup, scopes and limits](https://github.com/Aerya/Ether-Remix/blob/feat/submaker-integration/docs/pse/SUBMAKER.en.md). SeerrCatalog tests use a simulated provider. The Remix connector also retrieved a real SRT, and a short English-to-French translation succeeded; the complete SeerrCatalog flow and synchronized playback still need verification before production activation.

### v1 API contract

Paginated read with `Authorization: Bearer <token>`:

```http
GET /api/integrations/remix/v1/availability?after=0&limit=50
Authorization: Bearer <integration-token>
```

The response is `{ "schema": "seerrcatalog.availability.v1", "revision": 12, "items": [<snapshot>], "nextCursor": null }`. `after` is the last numeric media ID, with a page size between 1 and 100. Each snapshot includes:

- `media: { id, userId, type, imdbId, tmdbId, title, year }`;
- `available`, `availabilityConfirmed`, `checkStatus`, `checkedAt`, `expiresAt` and `releasesExpireAt`;
- `streamCount`, `addonsCount`, `appliedFilters`, `requirements`;
- `releases` containing `addonId`, `addonName`, exact Stremio `streamId` (series include season and episode), `name`, `title`, `quality`, `size`, and a limited `stream` descriptor (`url`, `infoHash`, etc.).

Confirmed availability remains in the feed beyond `expiresAt`; that field retains the legacy 26-hour window for old clients. Unconfirmed observations expire normally. Playback URLs and headers are removed after **30 minutes** at most, while stable torrent hashes remain reusable. Confirmation never refreshes sensitive links, which stay outside public catalogue/media APIs.

Every synchronization starts at `after=0`. Pass the returned `revision` on subsequent pages (`&revision=12`); HTTP 409 means restart. Replace local observations only after completing every page, removing absent media. The cursor is a media ID, **not an incremental change log**. This full reconciliation recovers missed deletions.

With a receiver configured, SeerrCatalog sends an authenticated `POST` to the **full URL configured by the admin**. Its body is `{ "schema": "seerrcatalog.availability.v1", "event": "availability.updated", "data": <snapshot> }`, or `event: "media.removed"` with `data.media`. A failing receiver never interrupts catalogue updates; polling catches up after outages. The Remix receiver is available at `/api/integrations/seerrcatalog/v1/events`. Events trigger a full feed refresh, so duplicate or out-of-order notifications cannot overwrite newer observations.

For a series, a result for an episode is **not** proof that the whole series is playable. Addon results are source observations, not guaranteed playback; Remix must apply its own policies and fall back to normal discovery when streams are expired or unusable. At most 10 releases per addon and 50 per media are exported. Stream URLs and headers may contain private access tokens: only connect a trusted Remix instance and use HTTPS outside a private network. Disabling clears stored snapshots; rotating the token invalidates the previous one immediately.

## Discord and Apprise notifications

Under **Settings → Apprise and review alerts**, enter the numeric Discord user ID to mention (Discord developer mode → Copy user ID). Direct webhooks allow only that user mention, never roles or `@everyone`.

[Apprise API](https://github.com/caronc/apprise-api) is optional. Enable it and enter the full `https://apprise.example/notify/key` endpoint for a saved configuration, or `/notify/` with notification destination URLs. Omit targets to use the server configuration. Save before **Test Apprise**. Sensitive destinations remain masked; an empty field preserves them and a checkbox clears them. Availability, removal and review events are sent. Apprise receives the mention in the message text; actual ping behavior depends on the target service and its mention configuration.


Discord reports confirmed availability, removals and single-release review after day 3. Availability alerts retain release details, applied filters and IMDb/TMDB links. Marking a title watched without deleting it is not a removal. Already confirmed titles do not generate another availability alert.

<!-- screenshots:start -->

### Day and night themes

<p><img src="screens/settings-light.png" alt="SeerrCatalog light" width="48%"> <img src="screens/settings-dark.png" alt="SeerrCatalog dark" width="48%"></p>

## Screenshots

### SeerrCatalog WebUI

<p align="center">
  <img src="screens/user-configuration.png" alt="SeerrCatalog user configuration" width="900">
</p>
<p align="center"><sub>
Complete per-user configuration: Stremio account, Radarr / Sonarr / Jellyfin endpoints, additional addons, filters and availability criteria.
</sub></p>

<table>
  <tr>
    <td width="50%" align="center"><strong>SeerrCatalog settings</strong></td>
    <td width="50%" align="center"><strong>Catalog</strong></td>
  </tr>
  <tr>
    <td><img src="screens/settings.webp" alt="SeerrCatalog TMDB and Jellyseerr settings"></td>
    <td><img src="screens/catalog.webp" alt="SeerrCatalog catalog"></td>
  </tr>
  <tr>
    <td align="center"><sub>TMDB configuration and Jellyseerr integration.</sub></td>
    <td align="center"><sub>Personal catalog with availability, media type and user filters.</sub></td>
  </tr>
</table>

### Jellyseerr integration

<table>
  <tr>
    <td width="50%" align="center"><strong>Radarr / Sonarr services</strong></td>
    <td width="50%" align="center"><strong>Creating a request</strong></td>
  </tr>
  <tr>
    <td><img src="screens/jellyseerr-services.webp" alt="Radarr and Sonarr configuration in Jellyseerr"></td>
    <td><img src="screens/jellyseerr-request.webp" alt="Creating a request in Jellyseerr"></td>
  </tr>
  <tr>
    <td align="center"><sub>Jellyseerr points to the Radarr and Sonarr endpoints emulated by SeerrCatalog.</sub></td>
    <td align="center"><sub>Requests are still created normally from Jellyseerr.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="screens/jellyseerr-requests.webp" alt="Jellyseerr requests and availability status" width="900">
</p>
<p align="center"><sub>
Requests automatically become available once SeerrCatalog validates the configured source criteria.
</sub></p>

### Source detection

<p align="center">
  <img src="screens/sources-summary.webp" alt="Summary of sources found by addon" width="850">
</p>
<p align="center"><sub>
Compact view of the addons that returned releases and the number of matching results.
</sub></p>

<p align="center">
  <img src="screens/sources-details.webp" alt="Detailed releases found by SeerrCatalog" width="430">
</p>
<p align="center"><sub>
Detailed release information including addon, quality, size and release name.
</sub></p>

### Stremio and compatible clients

<p align="center">
  <img src="screens/nuvio-catalog.webp" alt="SeerrCatalog catalog displayed in Nuvio" width="900">
</p>
<p align="center"><sub>
Catalogs generated by SeerrCatalog can be consumed by Stremio-addon-compatible clients, shown here in Nuvio.
</sub></p>
<!-- screenshots:end -->

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | SeerrCatalog HTTP port | `7000` |
| `HOST` | Listening interface | `0.0.0.0` |
| `TMDB_API_KEY` | TMDB API key used for metadata | — |
| `BASE_URL` | Public URL, especially behind a reverse proxy | auto-detected |
| `API_KEY` | API key exposed to compatible clients | — |

## Updating

Before updating, check [volume permissions and the Docker user](#docker-user-and-existing-volumes), especially for an older installation running as root.

With Docker Compose:

```bash
docker compose pull
docker compose up -d --force-recreate
```

A plain `docker compose restart` is not enough after a `pull`: it restarts the existing container with the image it was created from.

With Dockge / Dockge-Enhanced, use **Pull & Recreate** to apply a newly downloaded image.

## Security

Some `manifest.json` URLs may contain private tokens, keys or configuration parameters.

- Do not publish these URLs.
- Protect the `/app/data` volume, which contains application settings.
- Use HTTPS when the instance is exposed through a reverse proxy.
- Set `BASE_URL` to the public URL when SeerrCatalog runs behind a proxy.

### TLS security — October 2026

Update image trust stores and TLS components following the eMudhra incident. Checks cover the compromised chains, including both No CT cases, and a valid HTTPS connection. Running images remain unchanged: schedule their replacement after validation.

[Incident details](https://emudhra.we-have-a-problem.com/) · [TLS checks](security/emudhra/README.md)

## Documentation

Article and screenshots: [UpAndClear — SeerrCatalog, the Over/Jelly/Seerr addon for Stremio](https://upandclear.org/2026/01/03/seerrcatalog-laddon-over-jelly-seerr-pour-stremio/)

Docker image: [ghcr.io/aerya/stremio-seerr-catalog](https://github.com/Aerya/Stremio-Seerr-Catalog/pkgs/container/stremio-seerr-catalog)

## Project

Developed and maintained by [Aerya](https://github.com/Aerya).

Website: [UpAndClear](https://upandclear.org/)

If SeerrCatalog is useful to you, you can support the project by starring the repository.

## License

MIT — see [LICENSE](LICENSE).

Available items validated through fallback languages show a **VOSTFR** badge for VOSTFR/SUBFRENCH, or the custom tags actually used. The **Fallback languages** filter finds these items. **Search primary languages** in their details manually searches using the owner’s current primary tags, resolution and availability thresholds. When those criteria are met, sources are replaced, the fallback badge is removed and Remix sharing is updated. Errors, zero or too few releases keep the existing availability and fallback sources unchanged. This action does not restart automatic checks for confirmed items.

### Complementary search: Remix or Prowlarr

Under **Settings**, **Prowlarr complementary search** configures Prowlarr alone. **Ether Remix integration** groups availability sharing and search via Remix, each with its own switch and token. Only one complementary provider can be active: enabling Prowlarr replaces Remix, or vice versa, after saving. Save before **Test connection**:

- **Ether Remix → Search via Remix**: enter its base URL. Generate a dedicated search token in this section and paste it into **Remix → Sources → Stremio → SeerrCatalog → Search via Remix**. Enable searches in Remix and language fallback in user preferences, then save on both sides. Availability sharing and its token are independent and can remain disabled. After updating both applications, configure this new token: the old sharing token no longer authorizes searches. If addons return no primary-language release, Remix searches its configured indexers, including Prowlarr, while respecting availability search budgets.
- **Standalone Prowlarr**: enter its base URL and API key. Neither Remix nor a Stremio account is required. Prowlarr complements addons with no primary-language result, or operates alone. Primary languages take precedence; custom fallback tags apply only when enabled and no primary source matches.

Results are deduplicated across providers. Two distinct releases permanently confirm availability; one follows J+1/J+3 with notification and optional manual approval. Network errors never prove absence. Usable results from partial Remix searches still pass the same filters, thresholds and deduplication; checks remain incomplete if the threshold is not met. A five-minute cache shares identical complete searches; confirmed titles are never searched again.

Only torrents with a usable **infoHash** (or magnet hash) and actual HTTP streams from Remix are counted. NZB results and torrents without usable hashes are excluded; no downloads are triggered. Release discovery does not guarantee playback or debrid cache availability. Prowlarr does not automatically add these sources to Stremio playback addons: SeerrCatalog remains a catalogue addon. A complementary provider counts as one source toward the minimum source threshold.

Prowlarr credentials remain server-side and are never returned by settings APIs. Connection tests use saved settings. Delegation requires a version of [Remix](https://github.com/Aerya/Ether-Remix) supporting `/api/integrations/seerrcatalog/v1/search`.
