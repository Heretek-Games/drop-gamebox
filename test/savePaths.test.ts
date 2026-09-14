import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTitle,
  parseSavePathDefinitions,
  sanitizeSavePath,
  saveLocationKeys,
  toCloudSavePatterns,
} from "../src/index.js";

test("normalizeTitle lowercases and collapses whitespace", () => {
  assert.equal(normalizeTitle("  The   Witcher 3  "), "the witcher 3");
  assert.equal(normalizeTitle("HALO"), "halo");
});

test("sanitizeSavePath rejects local user paths and control characters", () => {
  assert.equal(sanitizeSavePath("<winAppData>/Game/Saves"), "<winAppData>/Game/Saves");
  assert.equal(sanitizeSavePath("  <base>/saves  "), "<base>/saves");
  assert.equal(sanitizeSavePath("C:\\Users\\alice\\Documents\\Game"), null);
  assert.equal(sanitizeSavePath("/home/alice/.local/share/game"), null);
  assert.equal(sanitizeSavePath("/Users/alice/Library/Game"), null);
  assert.equal(sanitizeSavePath("/var/home/alice/game"), null);
  assert.equal(sanitizeSavePath("bad\u0000path"), null);
  assert.equal(sanitizeSavePath("   "), null);
  assert.equal(sanitizeSavePath(42), null);
});

test("parseSavePathDefinitions accepts strings, objects and Ludusavi payloads", () => {
  assert.deepEqual(parseSavePathDefinitions("<base>/saves"), [
    { path: "<base>/saves" },
  ]);

  assert.deepEqual(
    parseSavePathDefinitions([
      { path: "<winAppData>/Game", platform: "windows", winePrefix: true },
      { path: "<xdgData>/game", platform: "linux", tags: ["config", ""] },
      "not-valid\u0000",
    ]),
    [
      { path: "<winAppData>/Game", platform: "windows", winePrefix: true },
      { path: "<xdgData>/game", platform: "linux", tags: ["config"] },
    ],
  );

  assert.deepEqual(
    parseSavePathDefinitions({ files: ["<base>/one", "<base>/one", "<base>/two"] }),
    [{ path: "<base>/one" }, { path: "<base>/two" }],
  );

  assert.deepEqual(parseSavePathDefinitions(undefined), []);
  assert.deepEqual(parseSavePathDefinitions(null), []);
});

test("parseSavePathDefinitions ignores unknown platforms", () => {
  assert.deepEqual(
    parseSavePathDefinitions([{ path: "<base>/saves", platform: "amiga" }]),
    [{ path: "<base>/saves" }],
  );
});

test("saveLocationKeys indexes by title, app id and hash", () => {
  assert.deepEqual(saveLocationKeys("My  Game", 123, "ABCDEF"), [
    "savepaths:title:my game",
    "savepaths:app:123",
    "savepaths:hash:abcdef",
  ]);
  assert.deepEqual(saveLocationKeys("Solo", undefined), [
    "savepaths:title:solo",
  ]);
});

test("toCloudSavePatterns filters by platform and preserves flags", () => {
  const definitions = [
    { path: "<winAppData>/Game", platform: "windows" as const, winePrefix: true },
    { path: "<xdgData>/game", platform: "linux" as const },
    { path: "<base>/shared" },
  ];

  assert.deepEqual(toCloudSavePatterns(definitions), [
    { pattern: "<winAppData>/Game", platform: "windows", winePrefix: true },
    { pattern: "<xdgData>/game", platform: "linux" },
    { pattern: "<base>/shared" },
  ]);

  assert.deepEqual(toCloudSavePatterns(definitions, { winePrefix: "/wine" }), [
    { pattern: "<winAppData>/Game", platform: "windows", winePrefix: true },
    { pattern: "<base>/shared" },
  ]);
});
