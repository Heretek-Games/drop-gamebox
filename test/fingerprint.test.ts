import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  computeDirectoryStructureHash,
  normalizeRelativePath,
  normalizeSha256Hex,
} from "../src/index.js";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("computeDirectoryStructureHash hashes an empty directory deterministically", () => {
  assert.equal(
    computeDirectoryStructureHash([]),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("computeDirectoryStructureHash produces a stable folder Merkle root", () => {
  const root = computeDirectoryStructureHash([
    { relativePath: "bin/game.exe", fileHash: sha256("game-binary") },
    { relativePath: "data/assets.pak", fileHash: sha256("assets") },
    { relativePath: "data/config/settings.ini", fileHash: sha256("settings") },
    { relativePath: "readme.txt", fileHash: sha256("readme") },
  ]);

  assert.equal(
    root,
    "3c7a3ecec9f81d03e8ed48c3a0bad3380f0a25c5e6791121dff7e1851db69705",
  );
});

test("computeDirectoryStructureHash handles nested directories and odd leaf counts", () => {
  const root = computeDirectoryStructureHash([
    { relativePath: "a.bin", fileHash: sha256("a") },
    { relativePath: "dir/b.bin", fileHash: sha256("b") },
    { relativePath: "dir/sub/c.bin", fileHash: sha256("c") },
  ]);

  assert.equal(
    root,
    "e734164f651f6fd315f991b6e0150b3229ade10d54c26e885d0349f2b373c30c",
  );
});

test("computeDirectoryStructureHash ignores entry order and path separator style", () => {
  const entries = [
    { relativePath: "a.bin", fileHash: sha256("a") },
    { relativePath: "dir/b.bin", fileHash: sha256("b") },
    { relativePath: "dir/sub/c.bin", fileHash: sha256("c") },
  ];
  const reordered = [...entries]
    .reverse()
    .map((entry) => ({
      ...entry,
      relativePath: entry.relativePath.replace(/\//g, "\\"),
    }));

  assert.equal(
    computeDirectoryStructureHash(reordered),
    computeDirectoryStructureHash(entries),
  );
});

test("computeDirectoryStructureHash normalizes file hash casing", () => {
  const entries = [
    { relativePath: "a.bin", fileHash: sha256("a").toUpperCase() },
    { relativePath: "dir/b.bin", fileHash: sha256("b").toUpperCase() },
  ];

  assert.equal(
    computeDirectoryStructureHash(entries),
    computeDirectoryStructureHash(
      entries.map((entry) => ({
        ...entry,
        fileHash: entry.fileHash.toLowerCase(),
      })),
    ),
  );
});

test("computeDirectoryStructureHash rejects invalid file hashes and paths", () => {
  assert.throws(
    () => computeDirectoryStructureHash([{ relativePath: "a.bin", fileHash: "nope" }]),
    /fileHash/,
  );
  assert.throws(
    () =>
      computeDirectoryStructureHash([
        { relativePath: "../escape.bin", fileHash: sha256("a") },
      ]),
    /\.\./,
  );
  assert.throws(
    () =>
      computeDirectoryStructureHash([
        { relativePath: "a.bin", fileHash: sha256("a") },
        { relativePath: "./a.bin", fileHash: sha256("b") },
      ]),
    /duplicate/,
  );
});

test("normalizeSha256Hex canonicalizes case and whitespace, rejects invalid values", () => {
  const lower = sha256("payload");

  assert.equal(normalizeSha256Hex(lower.toUpperCase()), lower);
  assert.equal(normalizeSha256Hex(`  ${lower.toUpperCase()}  `), lower);
  assert.equal(normalizeSha256Hex(lower), lower);
  assert.equal(normalizeSha256Hex("0".repeat(63)), null);
  assert.equal(normalizeSha256Hex(`${"0".repeat(63)}g`), null);
  assert.equal(normalizeSha256Hex("nonexistent-hash"), null);
  assert.equal(normalizeSha256Hex(undefined), null);
  assert.equal(normalizeSha256Hex(42), null);
});

test("normalizeRelativePath strips redundant prefixes and rejects traversal", () => {
  assert.equal(normalizeRelativePath("dir\\sub\\file.bin"), "dir/sub/file.bin");
  assert.equal(normalizeRelativePath("./dir//file.bin"), "dir/file.bin");
  assert.throws(() => normalizeRelativePath("../file.bin"), /\.\./);
  assert.throws(() => normalizeRelativePath(""), /empty/);
});
