import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";

export * from "./fingerprint.js";

async function getRequestBody<T = any>(event: any): Promise<T> {
  if (event && event.body !== undefined) {
    return event.body;
  }
  try {
    // @ts-ignore
    const h3 = await import("h3").catch(() => null);
    if (h3?.readBody) {
      return (await h3.readBody(event)) || ({} as T);
    }
    return (event?.body || {}) as T;
  } catch {
    return (event?.body || {}) as T;
  }
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
      const hash = (routeCtx.query.hash as string | undefined) ?? body?.hash;
      if (!hash) {
        return { error: "Missing hash parameter" };
      }
      const match = await ctx.storage.get(`fingerprint:${hash}`);
      return match ? { matched: true, game: match } : { matched: false };
    });

    // REST: Contribute fingerprint metadata
    ctx.registerRoute("POST", "/contribute", async (event) => {
      const body = await getRequestBody(event);
      const { hash, title, appId, releaseGroup, savePaths } = (body ||
        {}) as any;
      if (!hash || !title) {
        return { error: "hash and title are required" };
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
  }

  async teardown(): Promise<void> {
    // Teardown
  }
}
