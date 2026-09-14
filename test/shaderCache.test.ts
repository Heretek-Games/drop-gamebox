import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import GameBoxPlugin from "../src/index.js";
import {
  mergeShaderCache,
  rankShaderCaches,
  type ShaderCacheEntry,
} from "../src/shaderCache.js";

test("drop-gamebox registers the shader-cache routes", async () => {
  const ctx = new MockPluginContext("drop-gamebox", [
    "routes",
    "storage",
    "network",
  ]);
  await new GameBoxPlugin().init(ctx);
  assert.ok(ctx.routes.size >= 4);
});

test("mergeShaderCache refreshes recency without resetting downloads", () => {
  const existing: ShaderCacheEntry = {
    gameId: "g",
    driver: "amd",
    sha256: "abc",
    sizeBytes: 10,
    downloads: 7,
    updatedAt: 1,
  };
  const same = mergeShaderCache(
    existing,
    { gameId: "g", driver: "amd", sha256: "abc", sizeBytes: 10 },
    2,
  );
  assert.equal(same.downloads, 7);
  assert.equal(same.updatedAt, 2);

  const changed = mergeShaderCache(
    existing,
    { gameId: "g", driver: "amd", sha256: "def", sizeBytes: 12 },
    3,
  );
  assert.equal(changed.downloads, 0);
  assert.equal(changed.sha256, "def");
});

test("rankShaderCaches orders by downloads then recency", () => {
  const entries: ShaderCacheEntry[] = [
    { gameId: "g", driver: "a", sha256: "1", sizeBytes: 1, downloads: 1, updatedAt: 5 },
    { gameId: "g", driver: "b", sha256: "2", sizeBytes: 1, downloads: 9, updatedAt: 1 },
    { gameId: "g", driver: "c", sha256: "3", sizeBytes: 1, downloads: 1, updatedAt: 9 },
  ];
  assert.deepEqual(
    rankShaderCaches(entries).map((entry) => entry.driver),
    ["b", "c", "a"],
  );
});
