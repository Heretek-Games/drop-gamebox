import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import GameBoxPlugin from "../src/index.js";
import {
  MODERATION_REQUIRED_ENV,
  MODERATION_TOKEN_ENV,
  bearerToken,
  configureModerationToken,
  constantTimeEqual,
  isModeratorAuthorized,
  moderationRequired,
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

test("moderation helpers are fail-closed and parse token configuration", () => {
  assert.equal(moderationRequired("true"), true);
  assert.equal(moderationRequired("1"), true);
  assert.equal(moderationRequired("off"), false);
  assert.equal(moderationRequired(undefined), false);

  assert.equal(configureModerationToken("  "), undefined);
  assert.equal(configureModerationToken(" secret "), "secret");

  assert.equal(bearerToken("Bearer abc"), "abc");
  assert.equal(bearerToken("Basic abc"), undefined);
  assert.equal(bearerToken(undefined), undefined);

  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);

  assert.equal(isModeratorAuthorized("secret", "secret"), true);
  assert.equal(isModeratorAuthorized("wrong", "secret"), false);
  assert.equal(isModeratorAuthorized("secret", undefined), false);
  assert.equal(isModeratorAuthorized(undefined, "secret"), false);
});

test("contribution moderation queues, approves and rejects entries", async () => {
  const previousRequired = process.env[MODERATION_REQUIRED_ENV];
  const previousToken = process.env[MODERATION_TOKEN_ENV];
  process.env[MODERATION_REQUIRED_ENV] = "1";
  process.env[MODERATION_TOKEN_ENV] = "secret";

  try {
    const plugin = new GameBoxPlugin();
    const ctx = new MockPluginContext("drop-gamebox", [
      "routes",
      "storage",
      "network",
      "cloudsave:provider",
    ]);
    await plugin.init(ctx);

    const contribute = ctx.routes.get("POST /contribute");
    const queue = ctx.routes.get("GET /moderation/queue");
    const approve = ctx.routes.get("POST /moderation/approve");
    const reject = ctx.routes.get("POST /moderation/reject");
    assert.ok(contribute && queue && approve && reject);

    const submitted = (await contribute.handler(
      {
        body: { hash: testHash, title: "Test Game", savePaths: ["<base>/saves"] },
      } as any,
      { params: {}, query: {} },
    )) as any;
    assert.equal(submitted.pending, true);
    // Not published yet.
    assert.equal(await ctx.storage.get(`fingerprint:${testHash}`), null);

    const auth = { headers: new Headers({ authorization: "Bearer secret" }) };

    await expectStatus(
      () => queue.handler({ headers: new Headers() } as any, {
        params: {},
        query: {},
      }),
      403,
    );

    const listed = (await queue.handler(auth as any, {
      params: {},
      query: {},
    })) as any;
    assert.equal(listed.count, 1);

    await expectStatus(
      () => approve.handler({ body: { hash: testHash } } as any, {
        params: {},
        query: {},
      }),
      403,
    );

    const approved = (await approve.handler(
      { ...auth, body: { hash: testHash } } as any,
      { params: {}, query: {} },
    )) as any;
    assert.equal(approved.published, testHash);

    const stored = await ctx.storage.get<{ title: string }>(
      `fingerprint:${testHash}`,
    );
    assert.equal(stored?.title, "Test Game");
    // Save locations were published alongside the fingerprint.
    const savePaths = await ctx.storage.get(
      `savepaths:hash:${testHash}`,
    );
    assert.ok(savePaths);

    const emptied = (await queue.handler(auth as any, {
      params: {},
      query: {},
    })) as any;
    assert.equal(emptied.count, 0);

    // A rejected contribution is discarded, never published.
    const otherHash = "1".repeat(64);
    await contribute.handler(
      { body: { hash: otherHash, title: "Rejected" } } as any,
      { params: {}, query: {} },
    );
    const rejected = (await reject.handler(
      { ...auth, body: { hash: otherHash } } as any,
      { params: {}, query: {} },
    )) as any;
    assert.equal(rejected.rejected, otherHash);
    assert.equal(await ctx.storage.get(`fingerprint:${otherHash}`), null);
  } finally {
    if (previousRequired === undefined) delete process.env[MODERATION_REQUIRED_ENV];
    else process.env[MODERATION_REQUIRED_ENV] = previousRequired;
    if (previousToken === undefined) delete process.env[MODERATION_TOKEN_ENV];
    else process.env[MODERATION_TOKEN_ENV] = previousToken;
  }
});
