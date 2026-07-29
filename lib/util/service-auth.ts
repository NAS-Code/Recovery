import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token auth for service-to-service routes, where the caller is another
 * app rather than a browser. Sits alongside verifyCronAuth, which does the same
 * job for Vercel's cron trigger.
 *
 * Unlike verifyCronAuth this compares in constant time. A cron trigger leaking
 * timing barely matters; these routes return customer data, so the extra care
 * is worth the four lines.
 */
export function verifyServiceToken(
  authorizationHeader: string | null,
  expected: string | undefined
): boolean {
  if (!expected) return false; // unset means closed, never open

  const prefix = "Bearer ";
  const header = authorizationHeader ?? "";
  if (!header.startsWith(prefix)) return false;

  const supplied = header.slice(prefix.length);
  if (!supplied) return false;

  // Compare digests rather than raw strings: timingSafeEqual throws on length
  // mismatch, and returning early on that would leak the token's length.
  // Digests are always 32 bytes, so the comparison is uniform.
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
