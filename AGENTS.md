# AGENTS.md — Drop GameBox contributor & AI agent guide

**Drop GameBox** (`drop-gamebox`) is the metadata identification, binary fingerprinting, and save-location indexing plugin for the Drop platform.

---

## 1. Architecture

- **`src/fingerprint.ts`**: Core cryptographic fingerprint calculation (SHA-256 binary hashing, file tree normalization).
- **`src/savePaths.ts`**: Save-location registry (Ludusavi-style `SavePathDefinition`), validation/sanitization, and `CloudSavePattern` mapping.
- **`src/snapshot.ts`**: Verifiable index snapshots and mirror merge (`buildSnapshot` / `verifySnapshot` / `mergeSnapshot`), HMAC-SHA256 signed with `GAMEBOX_MIRROR_SECRET`.
- **`src/moderation.ts`**: Contribution review queue controls — `GAMEBOX_MODERATION_REQUIRED` / `GAMEBOX_MODERATION_TOKEN`, fail-closed moderator authorization, and constant-time token comparison.
- **`src/index.ts`**: Plugin entry point implementing `ServerPlugin` with `/identify` + `/identify/batch`, `/contribute` (optional bounded `recipe`), `/save-paths/import`, `/save-paths`, `/index/*`, `/moderation/*` and the shader-cache endpoints, plus the `cloudsave:provider` SPI resolver.
- **Capabilities**: `routes`, `storage`, `network`, `cloudsave:provider`.

---

## 2. Invariants

- **Storage Keying**: Fingerprint records must be keyed by lowercase hex SHA-256 string (`fingerprint:<hash>`).
- **Save-path safety**: Save-location records are keyed by `savepaths:hash:<hash>`, `savepaths:app:<appId>` and `savepaths:title:<normalized>`; definitions must never contain a local user path (`/home/<user>/`, `/Users/<user>/`, `C:\Users\...`) or control characters — `sanitizeSavePath` rejects them.
- **Data Sanitization**: Ensure contributed metadata never contains local user paths or credentials.
