import { createError, readBody } from "h3";
import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";
import {
  mergeShaderCache,
  rankShaderCaches,
  shaderCacheKey,
  type ShaderCacheIndex,
} from "./shaderCache.js";
import { normalizeSha256Hex } from "./fingerprint.js";
import {
  SAVE_LOCATION_APP_PREFIX,
  SAVE_LOCATION_GAME_PREFIX,
  SAVE_LOCATION_HASH_PREFIX,
  SAVE_LOCATION_TITLE_PREFIX,
  normalizeTitle,
  parseSavePathDefinitions,
  saveLocationKeys,
  toCloudSavePatterns,
  type SaveLocationRecord,
} from "./savePaths.js";
import {
  GAMEBOX_MIRROR_SECRET_ENV,
  buildSnapshot,
  mergeSnapshot,
  verifySnapshot,
  type IndexEntry,
  type IndexSnapshot,
} from "./snapshot.js";

export * from "./fingerprint.js";
export * from "./savePaths.js";
export * from "./shaderCache.js";
export * from "./snapshot.js";

const FINGERPRINT_PREFIX = "fingerprint:";

/** Operator-configured mirror signing secret, if any. */
function readMirrorSecret(): string | undefined {
  const secret = process.env[GAMEBOX_MIRROR_SECRET_ENV];
  return secret && secret.trim().length > 0 ? secret : undefined;
}

interface SaveLocationContribution {
  title: string;
  appId?: string | number;
  hash?: string;
  rawPaths: unknown;
  source: string;
}

/** Store a validated save-location record under every index key. */
async function persistSaveLocations(
  ctx: PluginContext,
  contribution: SaveLocationContribution,
): Promise<SaveLocationRecord | null> {
  const paths = parseSavePathDefinitions(contribution.rawPaths);
  if (paths.length === 0) {
    return null;
  }
  const record: SaveLocationRecord = {
    title: contribution.title,
    appId: contribution.appId,
    paths,
    source: contribution.source,
    updatedAt: Date.now(),
  };
  for (const key of saveLocationKeys(
    contribution.title,
    contribution.appId,
    contribution.hash,
  )) {
    await ctx.storage.set(key, record);
  }
  return record;
}

/** Resolve a save-location record from a client install context. */
async function lookupSaveLocation(
  ctx: PluginContext,
  context: { gameId: string; gameTitle: string },
): Promise<SaveLocationRecord | null> {
  const candidates = [
    `${SAVE_LOCATION_GAME_PREFIX}${context.gameId}`,
    `${SAVE_LOCATION_TITLE_PREFIX}${normalizeTitle(context.gameTitle)}`,
  ];
  for (const key of candidates) {
    const record = await ctx.storage.get<SaveLocationRecord>(key);
    if (record && Array.isArray(record.paths) && record.paths.length > 0) {
      return record;
    }
  }
  return null;
}

async function getRequestBody<T = any>(event: any): Promise<T> {
  if (event && event.body !== undefined) {
    return event.body;
  }
  try {
    return ((await readBody(event)) ?? ({} as T)) as T;
  } catch {
    return (event?.body || {}) as T;
  }
}

function invalidSha256Error(field: string) {
  return createError({
    statusCode: 400,
    statusMessage: `${field} must be a 64-character hex SHA-256 digest`,
  });
}

export default class GameBoxPlugin implements ServerPlugin {
  metadata = {
    id: "drop-gamebox",
    name: "GameBox Metadata & Fingerprint Provider",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: [
      "routes" as const,
      "storage" as const,
      "network" as const,
      "cloudsave:provider" as const,
    ],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing GameBox metadata matching plugin...");

    // REST: Identify a game from hash
    ctx.registerRoute("POST", "/identify", async (event, routeCtx) => {
      const body = await getRequestBody(event);
      const hash = normalizeSha256Hex(routeCtx.query.hash ?? body?.hash);
      if (!hash) {
        throw invalidSha256Error("hash");
      }
      const match = await ctx.storage.get(`fingerprint:${hash}`);
      return match ? { matched: true, game: match } : { matched: false };
    });

    // REST: Contribute fingerprint metadata
    ctx.registerRoute("POST", "/contribute", async (event) => {
      const body = await getRequestBody(event);
      const { hash: rawHash, title, appId, releaseGroup, savePaths } = (body ||
        {}) as any;
      if (!title) {
        throw createError({
          statusCode: 400,
          statusMessage: "title is required",
        });
      }
      const hash = normalizeSha256Hex(rawHash);
      if (!hash) {
        throw invalidSha256Error("hash");
      }
      const record = {
        title,
        appId,
        releaseGroup,
        savePaths,
        updatedAt: Date.now(),
      };
      await ctx.storage.set(`fingerprint:${hash}`, record);
      if (savePaths !== undefined) {
        await persistSaveLocations(ctx, {
          title,
          appId,
          hash,
          rawPaths: savePaths,
          source: "contribute",
        });
      }
      return { success: true, record };
    });

    // REST: Import save locations from a Ludusavi-style `{ files: [...] }` payload
    ctx.registerRoute("POST", "/save-paths/import", async (event) => {
      const body = await getRequestBody(event);
      const { title, appId, hash, files } = (body || {}) as any;
      if (!title) {
        throw createError({
          statusCode: 400,
          statusMessage: "title is required",
        });
      }
      const normalizedHash =
        hash === undefined ? undefined : (normalizeSha256Hex(hash) ?? undefined);
      if (hash !== undefined && !normalizedHash) {
        throw invalidSha256Error("hash");
      }
      const record = await persistSaveLocations(ctx, {
        title,
        appId,
        hash: normalizedHash,
        rawPaths: files,
        source: "ludusavi-import",
      });
      if (!record) {
        throw createError({
          statusCode: 400,
          statusMessage: "files must contain at least one valid save path",
        });
      }
      return { success: true, record };
    });

    // REST: Look up stored save locations by hash, app id or title
    ctx.registerRoute("GET", "/save-paths", async (_event, routeCtx) => {
      const { hash, appId, title } = routeCtx.query as Record<string, string>;
      const key = hash
        ? `${SAVE_LOCATION_HASH_PREFIX}${hash.toLowerCase()}`
        : appId
          ? `${SAVE_LOCATION_APP_PREFIX}${appId}`
          : title
            ? `${SAVE_LOCATION_TITLE_PREFIX}${normalizeTitle(title)}`
            : undefined;
      if (!key) {
        throw createError({
          statusCode: 400,
          statusMessage: "one of hash, appId or title is required",
        });
      }
      const record = await ctx.storage.get<SaveLocationRecord>(key);
      return record ? { found: true, record } : { found: false };
    });

    // REST: Signed, portable index snapshot for mirroring
    ctx.registerRoute("GET", "/index/snapshot", async () => {
      const keys = await ctx.storage.listKeys();
      const entries: IndexEntry[] = [];
      for (const key of keys) {
        if (!key.startsWith(FINGERPRINT_PREFIX)) continue;
        const record = await ctx.storage.get<Record<string, unknown>>(key);
        if (record) {
          entries.push({ hash: key.slice(FINGERPRINT_PREFIX.length), record });
        }
      }
      return buildSnapshot(entries, readMirrorSecret());
    });

    // REST: Incrementally merge a mirrored snapshot into this index
    ctx.registerRoute("POST", "/index/sync", async (event) => {
      const body = await getRequestBody(event);
      const snapshot = ((body as { snapshot?: IndexSnapshot })?.snapshot ??
        body) as IndexSnapshot;
      if (!snapshot || !Array.isArray(snapshot.entries)) {
        throw createError({
          statusCode: 400,
          statusMessage: "snapshot.entries is required",
        });
      }

      const secret = readMirrorSecret();
      const verification = verifySnapshot(snapshot, secret);
      if (!verification.valid) {
        throw createError({
          statusCode: 403,
          statusMessage: verification.reason ?? "invalid snapshot",
        });
      }

      const keys = await ctx.storage.listKeys();
      const local: IndexEntry[] = [];
      for (const key of keys) {
        if (!key.startsWith(FINGERPRINT_PREFIX)) continue;
        const record = await ctx.storage.get<Record<string, unknown>>(key);
        if (record) {
          local.push({ hash: key.slice(FINGERPRINT_PREFIX.length), record });
        }
      }

      const result = mergeSnapshot(local, snapshot.entries);
      for (const entry of result.merged) {
        await ctx.storage.set(`${FINGERPRINT_PREFIX}${entry.hash}`, entry.record);
      }

      return {
        success: true,
        verification,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        total: result.merged.length,
      };
    });

    // REST: Index size summary
    ctx.registerRoute("GET", "/index/stats", async () => {
      const keys = await ctx.storage.listKeys();
      const fingerprints = keys.filter((key) =>
        key.startsWith(FINGERPRINT_PREFIX),
      ).length;
      const saveLocations = keys.filter((key) =>
        key.startsWith(SAVE_LOCATION_HASH_PREFIX),
      ).length;
      return { fingerprints, saveLocations, signed: Boolean(readMirrorSecret()) };
    });

    // REST: Contribute a warmed DXVK/VKD3D shader cache
    ctx.registerRoute("POST", "/shader-cache/contribute", async (event) => {
      const body = await getRequestBody(event);
      const { gameId, driver, sha256, sizeBytes, dxvkVersion } = (body || {}) as {
        gameId?: string;
        driver?: string;
        sha256?: string;
        sizeBytes?: number;
        dxvkVersion?: string;
      };
      if (!gameId || !driver || !sha256 || typeof sizeBytes !== "number") {
        return {
          error: "gameId, driver, sha256 and sizeBytes are required",
        };
      }

      const key = shaderCacheKey(gameId);
      const index =
        (await ctx.storage.get<ShaderCacheIndex>(key)) ??
        ({} as ShaderCacheIndex);
      const entry = mergeShaderCache(
        index[driver] ?? null,
        { gameId, driver, sha256, sizeBytes, dxvkVersion },
        Date.now(),
      );
      index[driver] = entry;
      await ctx.storage.set(key, index);
      return { success: true, entry };
    });

    // REST: Ranked shader caches for a game
    ctx.registerRoute("GET", "/shader-cache/:gameId", async (_event, routeCtx) => {
      const gameId = routeCtx.params.gameId;
      const index =
        (await ctx.storage.get<ShaderCacheIndex>(shaderCacheKey(gameId))) ??
        ({} as ShaderCacheIndex);
      return { gameId, caches: rankShaderCaches(Object.values(index)) };
    });

    // SPI: surface stored save locations to the core cloud-save pipeline
    ctx.registerCloudSaveResolver({
      id: "drop-gamebox",
      name: "GameBox save locations",
      resolveSavePaths: async (context) => {
        const record = await lookupSaveLocation(ctx, context);
        return record ? toCloudSavePatterns(record.paths, context) : [];
      },
    });
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
