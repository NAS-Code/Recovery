import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, destroyAdminSession } from "@/lib/auth/admin-auth";
import {
  CAMPAIGN_COOKIE_NAME,
  destroyCampaignSession
} from "@/lib/auth/campaign-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Destroy whichever session exists
  const adminToken = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (adminToken) {
    await destroyAdminSession(adminToken);
  }

  const campaignToken = req.cookies.get(CAMPAIGN_COOKIE_NAME)?.value;
  if (campaignToken) {
    await destroyCampaignSession(campaignToken);
  }

  const res = NextResponse.json({ ok: true });

  // Clear both cookies
  for (const name of [ADMIN_COOKIE_NAME, CAMPAIGN_COOKIE_NAME]) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
  }

  return res;
}
