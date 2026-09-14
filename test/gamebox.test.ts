import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import GameBoxPlugin, { computeBinaryFingerprint } from "../src/index.js";

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
