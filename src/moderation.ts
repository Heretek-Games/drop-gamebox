import { timingSafeEqual } from "node:crypto";

/**
 * GameBox contribution moderation (#8).
 *
 * By default contributions are published immediately. Operators can require a
 * review queue (`GAMEBOX_MODERATION_REQUIRED`) so maintainers approve or reject
 * entries before they reach the shared index. Moderator access is a single
 * operator token (`GAMEBOX_MODERATION_TOKEN`) and is fail-closed: without a
 * configured token no moderation route is authorized.
 */

export const MODERATION_TOKEN_ENV = "GAMEBOX_MODERATION_TOKEN";
export const MODERATION_REQUIRED_ENV = "GAMEBOX_MODERATION_REQUIRED";

export function moderationRequired(
  value: string | undefined = process.env[MODERATION_REQUIRED_ENV],
): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function configureModerationToken(
  value: string | undefined = process.env[MODERATION_TOKEN_ENV],
): string | undefined {
  const token = value?.trim();
  return token && token.length > 0 ? token : undefined;
}

/** Constant-time comparison so a moderator token cannot be guessed by timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Whether the presented token may moderate. Fail-closed without a configured token. */
export function isModeratorAuthorized(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (!provided) return false;
  return constantTimeEqual(provided, expected);
}

/** Extract a bearer token from an `Authorization` header value. */
export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(" ");
  return scheme === "Bearer" && token ? token : undefined;
}
