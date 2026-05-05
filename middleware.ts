import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_COOKIE_NAME } from "@/lib/auth/context";

export function middleware(req: NextRequest) {
  const clientId = req.cookies.get(CLIENT_COOKIE_NAME)?.value;
  if (!clientId) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/campaigns/:path*"]
};
