# AGENTS.md — Drop GameBox contributor & AI agent guide

**Drop GameBox** (`drop-gamebox`) is the metadata identification, binary fingerprinting, and save-location indexing plugin for the Drop platform.

---

## 1. Architecture

- **`src/fingerprint.ts`**: Core cryptographic fingerprint calculation (SHA-256 binary hashing, file tree normalization).
- **`src/index.ts`**: Plugin entry point implementing `ServerPlugin` with `/identify` and `/contribute` endpoints.
- **Capabilities**: `routes`, `storage`, `network`.

---

## 2. Invariants

- **Storage Keying**: Fingerprint records must be keyed by lowercase hex SHA-256 string (`fingerprint:<hash>`).
- **Data Sanitization**: Ensure contributed metadata never contains local user paths or credentials.
