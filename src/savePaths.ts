import type { CloudSavePattern, GameInstallContext } from "@droposs/plugin-sdk";

/**
 * GameBox save-location registry.
 *
 * Maps an identified game to the filesystem locations where it stores save
 * data, modelled on the [Ludusavi manifest](https://github.com/mtkennerly/ludusavi-manifest)
 * schema. The definitions are surfaced to Drop core through the
 * `cloudsave:provider` SPI so cloud saves can be configured automatically.
 *
 * Definitions must never contain local user paths or credentials: user home
 * prefixes are rejected (see {@link sanitizeSavePath}) and contributors should
 * use portable placeholders such as `<base>`, `<winAppData>` or `<xdgData>`.
 */

export type SavePlatform = "windows" | "linux" | "macos";

const PLATFORMS: readonly SavePlatform[] = ["windows", "linux", "macos"];

export interface SavePathDefinition {
  /** Portable path or glob, e.g. `<winAppData>/Game/Saves`. */
  path: string;
  platform?: SavePlatform;
  /** Resolve relative to the configured Wine/Proton prefix. */
  winePrefix?: boolean;
  tags?: string[];
}

export interface SaveLocationRecord {
  title: string;
  appId?: string | number;
  paths: SavePathDefinition[];
  source: string;
  updatedAt: number;
}

export const SAVE_LOCATION_HASH_PREFIX = "savepaths:hash:";
export const SAVE_LOCATION_GAME_PREFIX = "savepaths:game:";
export const SAVE_LOCATION_APP_PREFIX = "savepaths:app:";
export const SAVE_LOCATION_TITLE_PREFIX = "savepaths:title:";

/** Absolute home-directory prefixes that would leak a local user path. */
const USER_PATH_PATTERNS = [
  /^[a-z]:\\users\\/i,
  /^\/home\/[^/]+\//i,
  /^\/users\/[^/]+\//i,
  /^\/var\/home\/[^/]+\//i,
];

/** Normalize a game title into a stable, case-insensitive lookup key. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function isPlatform(value: unknown): value is SavePlatform {
  return typeof value === "string" && PLATFORMS.includes(value as SavePlatform);
}

/**
 * Validate a single save-path entry, returning `null` for anything that is not
 * a safe, portable path.
 */
export function sanitizeSavePath(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const path = raw.trim();
  if (!path) {
    return null;
  }
  // Reject control characters and embedded NULs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    return null;
  }
  if (USER_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return null;
  }
  return path;
}

function coerceDefinition(raw: unknown): SavePathDefinition | null {
  if (typeof raw === "string") {
    const path = sanitizeSavePath(raw);
    return path ? { path } : null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const path = sanitizeSavePath(entry.path);
  if (!path) {
    return null;
  }
  const definition: SavePathDefinition = { path };
  if (isPlatform(entry.platform)) {
    definition.platform = entry.platform;
  }
  if (typeof entry.winePrefix === "boolean") {
    definition.winePrefix = entry.winePrefix;
  }
  if (Array.isArray(entry.tags)) {
    const tags = entry.tags.filter(
      (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
    );
    if (tags.length > 0) {
      definition.tags = tags;
    }
  }
  return definition;
}

/**
 * Parse a contributor payload (a bare string, an array, or a Ludusavi-style
 * `{ files: [...] }` object) into validated save-path definitions.
 *
 * Duplicate `(path, platform)` pairs are removed.
 */
export function parseSavePathDefinitions(raw: unknown): SavePathDefinition[] {
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (raw && typeof raw === "object" && "files" in raw) {
    const files = (raw as { files?: unknown }).files;
    entries = Array.isArray(files) ? files : [files];
  } else if (raw === undefined || raw === null) {
    return [];
  } else {
    entries = [raw];
  }

  const definitions: SavePathDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const definition = coerceDefinition(entry);
    if (!definition) {
      continue;
    }
    const key = `${definition.platform ?? "*"}\u0000${definition.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    definitions.push(definition);
  }
  return definitions;
}

/** Storage keys a save-location record is indexed under. */
export function saveLocationKeys(
  title: string,
  appId?: string | number,
  hash?: string,
): string[] {
  const keys = [`${SAVE_LOCATION_TITLE_PREFIX}${normalizeTitle(title)}`];
  if (appId !== undefined && appId !== null && `${appId}`.trim() !== "") {
    keys.push(`${SAVE_LOCATION_APP_PREFIX}${appId}`);
  }
  if (hash) {
    keys.push(`${SAVE_LOCATION_HASH_PREFIX}${hash.toLowerCase()}`);
  }
  return keys;
}

/**
 * Convert stored definitions into the SPI `CloudSavePattern` shape, optionally
 * restricted to a platform. Definitions without a platform always apply.
 */
export function toCloudSavePatterns(
  definitions: SavePathDefinition[],
  context?: Pick<GameInstallContext, "winePrefix">,
): CloudSavePattern[] {
  const platform: SavePlatform | undefined = context?.winePrefix
    ? "windows"
    : undefined;

  return definitions
    .filter(
      (definition) =>
        platform === undefined ||
        definition.platform === undefined ||
        definition.platform === platform,
    )
    .map((definition) => {
      const pattern: CloudSavePattern = { pattern: definition.path };
      if (definition.platform) {
        pattern.platform = definition.platform;
      }
      if (definition.winePrefix) {
        pattern.winePrefix = definition.winePrefix;
      }
      return pattern;
    });
}
