/**
 * Community DXVK/VKD3D shader-cache index (#17).
 *
 * Core clients collect `*.dxvk-cache` files and contribute them here keyed by
 * game + GPU driver, so other users can reuse warmed caches. Entries are ranked
 * by downloads then recency.
 */
export interface ShaderCacheEntry {
  gameId: string;
  driver: string;
  sha256: string;
  sizeBytes: number;
  dxvkVersion?: string;
  downloads: number;
  updatedAt: number;
}

export type ShaderCacheIndex = Record<string, ShaderCacheEntry>;

/**
 * Folds a contribution into the existing entry for the same driver. Re-sharing
 * the identical cache refreshes recency without resetting the download count;
 * a different cache replaces the bytes and resets the count.
 */
export function mergeShaderCache(
  existing: ShaderCacheEntry | null,
  incoming: Omit<ShaderCacheEntry, "downloads" | "updatedAt">,
  now: number,
): ShaderCacheEntry {
  if (existing && existing.sha256 === incoming.sha256) {
    return { ...existing, updatedAt: now };
  }
  return { ...incoming, downloads: 0, updatedAt: now };
}

/** Most-downloaded first, then most recent. */
export function rankShaderCaches(
  entries: ShaderCacheEntry[],
): ShaderCacheEntry[] {
  return [...entries].sort(
    (a, b) => b.downloads - a.downloads || b.updatedAt - a.updatedAt,
  );
}

export const shaderCacheKey = (gameId: string) => `shadercache:${gameId}`;
