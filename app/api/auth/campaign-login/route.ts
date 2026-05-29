import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  verifyAdminCredential
} from "@/lib/auth/admin-auth";
import {
  CAMPAIGN_COOKIE_NAME,
  verifyCampaignCredential
} from "@/lib/auth/campaign-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { error: "username and password required" },
      { status: 400 }
    );
  }

  const username = body.username.trim();
  const password = body.password;

  // 1) Try admin (Vendelux team) credentials first
  const adminToken = await verifyAdminCredential(username, password);
  if (adminToken) {
    const res = NextResponse.json({
      ok: true,
      role: "admin",
      redirectUrl: "/campaigns"
    });

    res.cookies.set(ADMIN_COOKIE_NAME, adminToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 // 1 hour
    });

    return res;
  }

  // 2) Try campaign (client) credentials
  const session = await verifyCampaignCredential(username, password);
  if (session) {
    const redirectUrl = `/campaigns/${encodeURIComponent(session.teamId)}/${encodeURIComponent(session.eventId)}`;

    const res = NextResponse.json({
      ok: true,
      role: "client",
      redirectUrl
    });

    res.cookies.set(CAMPAIGN_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 // 1 hour
    });

    return res;
  }

  return NextResponse.json(
    { error: "invalid credentials" },
    { status: 401 }
  );
}
