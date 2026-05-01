import { cookies } from "next/headers";

/**
 * Multi-tenant client context. The cookie-based implementation here is a
 * placeholder for real auth — swap in NextAuth, Clerk, or whatever Vendelux
 * uses by replacing only this file. Everything downstream consumes
 * { clientId } and is auth-provider-agnostic.
 */
export const CLIENT_COOKIE_NAME = "client_id";

export interface ClientContext {
  clientId: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "UnauthorizedError";
  }
}

export function getClientContext(): ClientContext | null {
  const value = cookies().get(CLIENT_COOKIE_NAME)?.value;
  if (!value) return null;
  return { clientId: value };
}

export function requireClientContext(): ClientContext {
  const ctx = getClientContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}
