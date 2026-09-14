import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * GameBox index snapshots and mirror sync (#7).
 *
 * A snapshot is a portable, verifiable copy of a GameBox fingerprint index. It
 * is designed to be served by any instance and mirrored by others so no single
 * central server is required. Integrity is checked with a SHA-256 checksum over
 * the canonical entries, optionally HMAC-SHA256 signed with an operator secret
 * (`GAMEBOX_MIRROR_SECRET`). Unsigned snapshots are only imported when no
 * secret is configured, enforcing "signed sources by default".
 */

export interface IndexEntry {
  /** Lowercase 64-hex SHA-256 fingerprint. */
  hash: string;
  record: Record<string, unknown>;
}

export interface IndexSnapshot {
  formatVersion: number;
  generatedAt: number;
  entries: IndexEntry[];
  checksum: string;
  signature?: string;
}

export interface SnapshotVerification {
  valid: boolean;
  signed: boolean;
  reason?: string;
}

export interface SnapshotMergeResult {
  merged: IndexEntry[];
  added: number;
  updated: number;
  skipped: number;
}

export const SNAPSHOT_FORMAT_VERSION = 1;
export const GAMEBOX_MIRROR_SECRET_ENV = "GAMEBOX_MIRROR_SECRET";

/** Deterministic JSON so the checksum is stable across runs. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over the sorted canonical `(hash, record)` pairs. */
export function snapshotChecksum(entries: IndexEntry[]): string {
  const canonical = entries
    .map((entry) => `${entry.hash}\u0000${stableStringify(entry.record)}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Build a deterministic snapshot, signing it when a secret is provided. */
export function buildSnapshot(
  entries: IndexEntry[],
  secret?: string,
): IndexSnapshot {
  const sorted = [...entries].sort((a, b) => a.hash.localeCompare(b.hash));
  const checksum = snapshotChecksum(sorted);
  const snapshot: IndexSnapshot = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    generatedAt: Date.now(),
    entries: sorted,
    checksum,
  };
  if (secret) {
    snapshot.signature = createHmac("sha256", secret)
      .update(checksum)
      .digest("hex");
  }
  return snapshot;
}

/**
 * Verify a snapshot's checksum and signature.
 *
 * - A checksum mismatch is always invalid.
 * - When a secret is configured, an unsigned snapshot is rejected.
 * - A signature is only cryptographically verified when the secret is known;
 *   without a secret a signed snapshot is accepted as "signed but unverified".
 */
export function verifySnapshot(
  snapshot: Pick<IndexSnapshot, "entries" | "checksum" | "signature">,
  secret?: string,
): SnapshotVerification {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  if (snapshotChecksum(entries) !== snapshot.checksum) {
    return {
      valid: false,
      signed: Boolean(snapshot.signature),
      reason: "checksum mismatch",
    };
  }
  if (!snapshot.signature) {
    return secret
      ? { valid: false, signed: false, reason: "unsigned snapshot" }
      : { valid: true, signed: false };
  }
  if (!secret) {
    return { valid: true, signed: true };
  }
  const expected = createHmac("sha256", secret)
    .update(snapshot.checksum)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(snapshot.signature);
  const valid =
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf);
  return {
    valid,
    signed: true,
    ...(valid ? {} : { reason: "signature mismatch" }),
  };
}

/**
 * Merge incoming entries into a local index. Newest `record.updatedAt` wins;
 * entries that are not newer are skipped.
 */
export function mergeSnapshot(
  local: IndexEntry[],
  incoming: IndexEntry[],
): SnapshotMergeResult {
  const byHash = new Map(local.map((entry) => [entry.hash, entry]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of incoming) {
    const existing = byHash.get(entry.hash);
    if (!existing) {
      byHash.set(entry.hash, entry);
      added += 1;
      continue;
    }
    const previous = Number(existing.record.updatedAt ?? 0);
    const next = Number(entry.record.updatedAt ?? 0);
    if (next > previous) {
      byHash.set(entry.hash, entry);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    merged: [...byHash.values()].sort((a, b) => a.hash.localeCompare(b.hash)),
    added,
    updated,
    skipped,
  };
}
