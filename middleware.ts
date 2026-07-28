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

  /* ---- /admin requires admin_session cookie ---- */
  if (pathname.startsWith("/admin")) {
    // Allow the login page through without a cookie
    if (pathname === "/admin/login") {
      return NextResponse.next();
    }

    const hasAdmin = !!req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!hasAdmin) {
      const url = new URL("/admin/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  /* ---- /customer requires admin_session OR campaign_session cookie ---- */
  if (pathname.startsWith("/customer")) {
    // Allow the login page through without a cookie
    if (pathname === "/customer/login") {
      return NextResponse.next();
    }

    const hasAdmin = !!req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const hasCampaign = !!req.cookies.get(CAMPAIGN_COOKIE_NAME)?.value;

    if (!hasAdmin && !hasCampaign) {
      const url = new URL("/customer/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Cookie exists — let the server component do full validation + scoping.
    return NextResponse.next();
  }

  /* ---- Legacy /campaigns routes → redirect to new paths ---- */
  if (pathname.startsWith("/campaigns")) {
    // /campaigns/login → /customer/login (preserve query params)
    if (pathname === "/campaigns/login") {
      const url = new URL("/customer/login", req.url);
      req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
      return NextResponse.redirect(url, 301);
    }
    // /campaigns/activity → /admin/activity
    if (pathname === "/campaigns/activity") {
      return NextResponse.redirect(new URL("/admin/activity", req.url), 301);
    }
    // /campaigns/[teamId]/[eventId] → /customer/[teamId]/[eventId]
    const campaignDashMatch = pathname.match(/^\/campaigns\/([^/]+)\/([^/]+)$/);
    if (campaignDashMatch) {
      return NextResponse.redirect(
        new URL(`/customer/${campaignDashMatch[1]}/${campaignDashMatch[2]}`, req.url),
        301
      );
    }
    // /campaigns → /admin/campaigns
    if (pathname === "/campaigns") {
      return NextResponse.redirect(new URL("/admin/campaigns", req.url), 301);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin", "/admin/:path*", "/customer", "/customer/:path*", "/campaigns", "/campaigns/:path*"]
};
