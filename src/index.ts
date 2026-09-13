import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";
import { computeBinaryFingerprint } from "./fingerprint.js";

export * from "./fingerprint.js";

export default class GameBoxPlugin implements ServerPlugin {
  metadata = {
    id: "drop-gamebox",
    name: "GameBox Metadata & Fingerprint Provider",
    version: "0.1.0",
    apiVersion: 1,
    capabilities: ["routes" as const, "storage" as const, "network" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Initializing GameBox metadata matching plugin...");

    // REST: Identify a game from hash
    ctx.registerRoute("POST", "/identify", async (event, routeCtx) => {
      const hash = routeCtx.query.hash as string | undefined;
      if (!hash) {
        return { error: "Missing hash parameter" };
      }
      const match = await ctx.storage.get(`fingerprint:${hash}`);
      return match ? { matched: true, game: match } : { matched: false };
    });

    // REST: Contribute fingerprint metadata
    ctx.registerRoute("POST", "/contribute", async (event, routeCtx) => {
      const { hash, title, appId, releaseGroup, savePaths } = (event.body || {}) as any;
      if (!hash || !title) {
        return { error: "hash and title are required" };
      }
      const record = { title, appId, releaseGroup, savePaths, updatedAt: Date.now() };
      await ctx.storage.set(`fingerprint:${hash}`, record);
      return { success: true, record };
    });
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
