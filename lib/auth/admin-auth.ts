/**
 * Admin authentication for the Vendelux team.
 *
 * Credentials come from env vars: CAMPAIGNS_ADMIN_USERNAME / CAMPAIGNS_ADMIN_PASSWORD.
 * Sessions are STATELESS — an HMAC-signed token is stored in an httpOnly cookie.
 * If the admin password changes, all existing tokens auto-invalidate.
 */
import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "admin_session";

const TOKEN_SEPARATOR = ".";

/** Derive an HMAC signing key from the admin password (acts as a secret). */
function signingKey(): string {
  const pass = process.env.CAMPAIGNS_ADMIN_PASSWORD;
  if (!pass) throw new Error("CAMPAIGNS_ADMIN_PASSWORD is not set");
  return pass;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

export async function verifyAdminCredential(
  username: string,
  password: string
): Promise<string | null> {
  const adminUser = process.env.CAMPAIGNS_ADMIN_USERNAME;
  const adminPass = process.env.CAMPAIGNS_ADMIN_PASSWORD;

  if (!adminUser || !adminPass) return null;
  if (username !== adminUser || password !== adminPass) return null;

  // Build a stateless signed token: nonce.expiry.signature
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  const payload = `${nonce}${TOKEN_SEPARATOR}${expiresAt}`;
  const sig = sign(payload);

  return `${payload}${TOKEN_SEPARATOR}${sig}`;
}

/* ------------------------------------------------------------------ */
/*  Session validation                                                 */
/* ------------------------------------------------------------------ */

export async function validateAdminSession(token: string): Promise<boolean> {
  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 3) return false;

  const [nonce, expiryStr, sig] = parts;
  const payload = `${nonce}${TOKEN_SEPARATOR}${expiryStr}`;

  // Verify signature
  const expected = sign(payload);
  if (sig !== expected) return false;

  // Check expiry
  const expiresAt = parseInt(expiryStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  return true;
}

/* ------------------------------------------------------------------ */
/*  Cookie-based context helper (for server components)                */
/* ------------------------------------------------------------------ */

export async function isAdminAuthenticated(): Promise<boolean> {
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  return validateAdminSession(token);
}

/* ------------------------------------------------------------------ */
/*  Logout (stateless — just clear the cookie, no DB cleanup)          */
/* ------------------------------------------------------------------ */

export async function destroyAdminSession(_token: string): Promise<void> {
  // No-op for stateless tokens. Cookie clearing happens in the logout route.
}
