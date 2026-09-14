import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import GameBoxPlugin, {
  buildSnapshot,
  computeBinaryFingerprint,
} from "../src/index.js";

const testHash =
  "abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890";

function isStatus(error: unknown, statusCode: number): boolean {
  return (error as { statusCode?: number })?.statusCode === statusCode;
}

async function expectStatus(
  handler: () => unknown,
  statusCode: number,
): Promise<void> {
  await assert.rejects(
    async () => {
      await handler();
    },
    (error: unknown) => isStatus(error, statusCode),
  );
}

test("computeBinaryFingerprint computes sha256 and file size accurately", () => {
  const data = Buffer.from("test binary payload");
  const fp = computeBinaryFingerprint(data, "bin/game.exe");

  assert.equal(fp.relativeFilePath, "bin/game.exe");
  assert.equal(fp.fileSizeBytes, data.length);
  assert.equal(
    fp.executableHash,
    "a4300ea22b639569a54700ad82e5762116156c4316ff6b2a704b8c726177a4b1",
  );
});

test("GameBoxPlugin registers routes, contributes metadata, and identifies matches", async () => {
  const plugin = new GameBoxPlugin();
  const ctx = new MockPluginContext("drop-gamebox", [
    "routes",
    "storage",
    "network",
    "cloudsave:provider",
  ]);

  await plugin.init(ctx);

  const identifyRoute = ctx.routes.get("POST /identify");
  assert.ok(identifyRoute, "POST /identify must be registered");

  const contributeRoute = ctx.routes.get("POST /contribute");
  assert.ok(contributeRoute, "POST /contribute must be registered");

  // POST /contribute: missing title is a 400
  await expectStatus(
    () =>
      contributeRoute.handler(
        { body: { hash: testHash } } as any,
        { params: {}, query: {} },
      ),
    400,
  );

  // POST /contribute: invalid hash is a 400
  await expectStatus(
    () =>
      contributeRoute.handler(
        { body: { hash: "not-a-sha256", title: "Test Game" } } as any,
        { params: {}, query: {} },
      ),
    400,
  );

  // POST /contribute: successful contribution with uppercase hash
  const contributeRes = (await contributeRoute.handler(
    {
      body: {
        hash: testHash.toUpperCase(),
        title: "Test Game",
        appId: 12345,
        releaseGroup: "HERETEK",
        savePaths: ["saves/slot1.sav"],
      },
    } as any,
    { params: {}, query: {} },
  )) as any;

  assert.equal(contributeRes.success, true);
  assert.equal(contributeRes.record.title, "Test Game");
  assert.equal(contributeRes.record.appId, 12345);

  // POST /identify: invalid hash is a 400
  await expectStatus(
    () =>
      identifyRoute.handler({ body: {} } as any, {
        params: {},
        query: { hash: "nonexistent-hash" },
      }),
    400,
  );

  // POST /identify: missing hash is a 400
  await expectStatus(
    () =>
      identifyRoute.handler({ body: {} } as any, {
        params: {},
        query: {},
      }),
    400,
  );

  // POST /identify: unknown but well-formed hash
  const missRes = (await identifyRoute.handler({ body: {} } as any, {
    params: {},
    query: { hash: "0".repeat(64) },
  })) as any;
  assert.deepEqual(missRes, { matched: false });

  // POST /identify: hit via query parameter with lowercase-normalized hash
  const matchQueryRes = (await identifyRoute.handler({ body: {} } as any, {
    params: {},
    query: { hash: testHash.toLowerCase() },
  })) as any;
  assert.equal(matchQueryRes.matched, true);
  assert.equal(matchQueryRes.game.title, "Test Game");

  // POST /identify: hit via body with uppercase hash
  const matchBodyRes = (await identifyRoute.handler(
    { body: { hash: testHash.toUpperCase() } } as any,
    { params: {}, query: {} },
  )) as any;
  assert.equal(matchBodyRes.matched, true);
  assert.equal(matchBodyRes.game.title, "Test Game");

  // Storage is keyed by the normalized lowercase digest
  const stored = await ctx.storage.get(`fingerprint:${testHash}`);
  assert.ok(stored, "fingerprint must be stored under the lowercase digest");
});

test("GameBoxPlugin resolves cloud-save paths through the SPI", async () => {
  const plugin = new GameBoxPlugin();
  const ctx = new MockPluginContext("drop-gamebox", [
    "routes",
    "storage",
    "cloudsave:provider",
  ]);

  await plugin.init(ctx);

  const resolver = ctx.cloudSaveResolvers.get("drop-gamebox");
  assert.ok(resolver, "drop-gamebox resolver must be registered");

  assert.deepEqual(
    await resolver.resolveSavePaths({
      gameId: "abc",
      gameTitle: "Unknown Game",
    }),
    [],
  );

  const importRoute = ctx.routes.get("POST /save-paths/import");
  assert.ok(importRoute, "POST /save-paths/import must be registered");

  await expectStatus(
    () => importRoute.handler({ body: {} } as any, { params: {}, query: {} }),
    400,
  );

  const imported = (await importRoute.handler(
    {
      body: {
        title: "Test Game",
        appId: 12345,
        hash: testHash,
        files: [
          { path: "<winAppData>/TestGame", platform: "windows" },
          { path: "<xdgData>/test-game", platform: "linux" },
        ],
      },
    } as any,
    { params: {}, query: {} },
  )) as any;
  assert.equal(imported.success, true);
  assert.equal(imported.record.paths.length, 2);

  const resolved = await resolver.resolveSavePaths({
    gameId: "unknown-id",
    gameTitle: "test   game",
  });
  assert.deepEqual(resolved, [
    { pattern: "<winAppData>/TestGame", platform: "windows" },
    { pattern: "<xdgData>/test-game", platform: "linux" },
  ]);

  // Wine/Proton contexts only receive Windows-applicable patterns.
  const resolvedWine = await resolver.resolveSavePaths({
    gameId: "unknown-id",
    gameTitle: "Test Game",
    winePrefix: "/home/user/.wine",
  });
  assert.deepEqual(resolvedWine, [
    { pattern: "<winAppData>/TestGame", platform: "windows" },
  ]);

  const lookupRoute = ctx.routes.get("GET /save-paths");
  assert.ok(lookupRoute, "GET /save-paths must be registered");
  const lookup = (await lookupRoute.handler({} as any, {
    params: {},
    query: { hash: testHash },
  })) as any;
  assert.equal(lookup.found, true);
  assert.equal(lookup.record.title, "Test Game");
});

test("GameBoxPlugin serves and merges index snapshots", async () => {
  const plugin = new GameBoxPlugin();
  const ctx = new MockPluginContext("drop-gamebox", [
    "routes",
    "storage",
    "network",
    "cloudsave:provider",
  ]);
  await plugin.init(ctx);

  const contribute = ctx.routes.get("POST /contribute");
  assert.ok(contribute);
  await contribute.handler(
    { body: { hash: testHash, title: "Test Game", appId: 1 } } as any,
    { params: {}, query: {} },
  );

  const snapshotRoute = ctx.routes.get("GET /index/snapshot");
  assert.ok(snapshotRoute);
  const snapshot = (await snapshotRoute.handler({} as any, {
    params: {},
    query: {},
  })) as any;
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].hash, testHash);

  const syncRoute = ctx.routes.get("POST /index/sync");
  assert.ok(syncRoute);

  const otherHash = "1".repeat(64);
  const incoming = buildSnapshot([
    { hash: otherHash, record: { title: "Other", updatedAt: Date.now() } },
  ]);
  const merged = (await syncRoute.handler(
    { body: { snapshot: incoming } } as any,
    { params: {}, query: {} },
  )) as any;
  assert.equal(merged.success, true);
  assert.equal(merged.added, 1);
  assert.equal(merged.total, 2);

  // A tampered snapshot is rejected before any write.
  const tampered = {
    ...incoming,
    entries: [{ hash: "2".repeat(64), record: { title: "Evil" } }],
  };
  await expectStatus(
    () =>
      syncRoute.handler({ body: { snapshot: tampered } } as any, {
        params: {},
        query: {},
      }),
    403,
  );

  const stats = (await ctx.routes
    .get("GET /index/stats")!
    .handler({} as any, { params: {}, query: {} })) as any;
  assert.equal(stats.fingerprints, 2);
});


test("contribute stores a recipe and batch identify resolves many hashes", async () => {
  const plugin = new GameBoxPlugin();
  const ctx = new MockPluginContext("drop-gamebox", [
    "routes",
    "storage",
    "network",
    "cloudsave:provider",
  ]);
  await plugin.init(ctx);

  const contribute = ctx.routes.get("POST /contribute");
  const identify = ctx.routes.get("POST /identify");
  const batch = ctx.routes.get("POST /identify/batch");
  assert.ok(contribute && identify && batch);

  const recipe = { steps: [{ action: "extract_iso" }] };
  await contribute.handler(
    { body: { hash: testHash, title: "With Recipe", recipe } } as any,
    { params: {}, query: {} },
  );
  const match = (await identify.handler(
    { body: { hash: testHash } } as any,
    { params: {}, query: {} },
  )) as any;
  assert.equal(match.matched, true);
  assert.deepEqual(match.game.recipe, recipe);

  await expectStatus(
    () =>
      contribute.handler(
        { body: { hash: testHash, title: "Bad", recipe: "nope" } } as any,
        { params: {}, query: {} },
      ),
    400,
  );

  const other = "2".repeat(64);
  await contribute.handler(
    { body: { hash: other, title: "Other" } } as any,
    { params: {}, query: {} },
  );

  const resolved = (await batch.handler(
    { body: { hashes: [testHash, other, "not-a-hash"] } } as any,
    { params: {}, query: {} },
  )) as any;
  assert.equal(resolved.count, 3);
  assert.equal(resolved.results[0].matched, true);
  assert.equal(resolved.results[1].matched, true);
  assert.equal(resolved.results[2].matched, false);
  assert.equal(resolved.results[2].error, "invalid hash");

  await expectStatus(
    () => batch.handler({ body: { hashes: "nope" } } as any, { params: {}, query: {} }),
    400,
  );
  await expectStatus(
    () =>
      batch.handler(
        { body: { hashes: new Array(101).fill(testHash) } } as any,
        { params: {}, query: {} },
      ),
    400,
  );
});
