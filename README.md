# drop-gamebox

Shared Game Metadata and Hash Database ("GameBox") plugin for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-gamebox).

## Overview

Inspired by the Stash-box architecture for community identification, GameBox enables Drop instances to:

1. **Fingerprint**: Calculate SHA-256 binary digests and relative folder structural hashes for games.
2. **Identify**: Query federated GameBox indices to resolve game title, release group, executable launch configs, and save file directories automatically.
3. **Contribute**: Submit verified game configurations and save mappings back to community mirrors.

Built on the `@droposs/plugin-sdk`.

## Cloud save locations

GameBox implements the `cloudsave:provider` SPI. Save locations are modelled on
the [Ludusavi manifest](https://github.com/mtkennerly/ludusavi-manifest) schema
and served to Drop core via `CloudSavePathResolver`, so installing a known game
can propose cloud-save locations automatically.

- `POST /save-paths/import` — import a Ludusavi-style `{ title, appId?, hash?, files: [...] }`
  payload. Each file may be a string or `{ path, platform?, winePrefix?, tags? }`.
- `POST /contribute` — accepts an optional `savePaths` array alongside the fingerprint.
- `GET /save-paths?hash=|appId=|title=` — inspect a stored record.
- Definitions are indexed by hash, app id and normalized title; the resolver
  returns Windows-applicable patterns for Wine/Proton contexts and filters
  out anything that would leak a local user path.

## Mirroring

GameBox indexes can be mirrored so instances do not depend on a single central
server.

- `GET /index/snapshot` — a deterministic, checksummed snapshot
  (`formatVersion`, `generatedAt`, `entries`, `checksum`), HMAC-SHA256 signed
  when `GAMEBOX_MIRROR_SECRET` is set.
- `POST /index/sync` — verifies and incrementally merges a snapshot (newest
  `updatedAt` wins). Unsigned snapshots are rejected when a secret is
  configured, so mirrors are trusted by default.
- `GET /index/stats` — fingerprint/save-location counts and signing status.

## Moderation

Operators can require review before a contribution reaches the shared index:

- `GAMEBOX_MODERATION_REQUIRED=true` — `POST /contribute` queues the entry as
  pending instead of publishing it.
- `GAMEBOX_MODERATION_TOKEN=<secret>` — required for the moderation routes;
  when unset moderation is fail-closed (no route is authorized).
- `GET /moderation/queue` lists pending entries; `POST /moderation/approve`
  and `POST /moderation/reject` take `{ hash }` and publish or discard the
  entry. Approving also publishes its save locations.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run typecheck
```

