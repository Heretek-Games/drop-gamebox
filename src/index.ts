import { createError, readBody } from "h3";
import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";
import {
  mergeShaderCache,
  rankShaderCaches,
  shaderCacheKey,
  type ShaderCacheIndex,
} from "./shaderCache.js";
import { normalizeSha256Hex } from "./fingerprint.js";

export * from "./fingerprint.js";
export * from "./shaderCache.js";

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
    capabilities: ["routes" as const, "storage" as const, "network" as const],
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
      return { success: true, record };
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
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
