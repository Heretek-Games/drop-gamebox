import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import GameBoxPlugin from "../src/index.js";

// Drop's PluginManager replaces the class metadata with the shipped manifest,
// so a capability the code requires but the manifest omits fails at init.
const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "drop-plugin.json"), "utf-8"),
) as { capabilities: string[] };

const required = new GameBoxPlugin().metadata.capabilities as string[];

test("shipped manifest grants every capability the plugin declares", () => {
  const declared = new Set(manifest.capabilities);
  const missing = required.filter((capability) => !declared.has(capability));
  assert.deepEqual(
    missing,
    [],
    `manifest is missing required capabilities: ${missing.join(", ")}`,
  );
});

test("shipped manifest declares no unused capabilities", () => {
  const requiredSet = new Set(required);
  const extra = manifest.capabilities.filter((cap) => !requiredSet.has(cap));
  assert.deepEqual(
    extra,
    [],
    `manifest declares unused capabilities: ${extra.join(", ")}`,
  );
});
