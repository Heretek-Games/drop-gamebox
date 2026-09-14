import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  mergeSnapshot,
  snapshotChecksum,
  stableStringify,
  verifySnapshot,
  type IndexEntry,
} from "../src/index.js";

const entries: IndexEntry[] = [
  { hash: "aa", record: { title: "A", updatedAt: 100 } },
  { hash: "bb", record: { title: "B", updatedAt: 200 } },
];

test("stableStringify sorts object keys recursively", () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("snapshot checksum is order-independent", () => {
  assert.equal(
    snapshotChecksum(entries),
    snapshotChecksum([...entries].reverse()),
  );
});

test("verifySnapshot accepts unsigned snapshots only without a secret", () => {
  const snapshot = buildSnapshot(entries);
  assert.deepEqual(verifySnapshot(snapshot), { valid: true, signed: false });

  const rejected = verifySnapshot(snapshot, "s3cret");
  assert.equal(rejected.valid, false);
  assert.equal(rejected.signed, false);
  assert.match(rejected.reason ?? "", /unsigned/);

  const tampered = {
    ...snapshot,
    entries: [{ hash: "aa", record: { title: "HACKED", updatedAt: 1 } }],
  };
  assert.equal(verifySnapshot(tampered).valid, false);
});

test("verifySnapshot verifies HMAC signatures", () => {
  const snapshot = buildSnapshot(entries, "s3cret");
  assert.deepEqual(verifySnapshot(snapshot, "s3cret"), {
    valid: true,
    signed: true,
  });
  assert.equal(verifySnapshot(snapshot, "wrong").valid, false);
  assert.equal(
    verifySnapshot({ ...snapshot, signature: "0".repeat(64) }, "s3cret").valid,
    false,
  );
});

test("mergeSnapshot adds new entries and updates newer ones", () => {
  const local: IndexEntry[] = [
    { hash: "aa", record: { title: "A", updatedAt: 100 } },
  ];
  const result = mergeSnapshot(local, [
    { hash: "aa", record: { title: "A2", updatedAt: 150 } },
    { hash: "bb", record: { title: "B", updatedAt: 50 } },
  ]);

  assert.equal(result.updated, 1);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 0);
  assert.equal(
    result.merged.find((entry) => entry.hash === "aa")?.record.title,
    "A2",
  );

  const stale = mergeSnapshot(local, [
    { hash: "aa", record: { title: "old", updatedAt: 10 } },
  ]);
  assert.equal(stale.skipped, 1);
  assert.equal(stale.updated, 0);
  assert.equal(stale.added, 0);
});
