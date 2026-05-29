import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_COOKIE_NAME } from "@/lib/auth/context";

const ADMIN_COOKIE_NAME = "admin_session";
const CAMPAIGN_COOKIE_NAME = "campaign_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /* ---- /dashboard requires the internal client_id cookie ---- */
  if (pathname.startsWith("/dashboard")) {
    const clientId = req.cookies.get(CLIENT_COOKIE_NAME)?.value;
    if (!clientId) {
      const url = new URL("/sign-in", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  /* ---- /campaigns requires admin_session OR campaign_session cookie ---- */
  if (pathname.startsWith("/campaigns")) {
    // Allow the login page through without a cookie
    if (pathname === "/campaigns/login") {
      return NextResponse.next();
    }

    const hasAdmin = !!req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const hasCampaign = !!req.cookies.get(CAMPAIGN_COOKIE_NAME)?.value;

    if (!hasAdmin && !hasCampaign) {
      const url = new URL("/campaigns/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Cookie exists — let the server component do full validation + scoping.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/campaigns/:path*"]
};
