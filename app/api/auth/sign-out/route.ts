import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_COOKIE_NAME } from "@/lib/auth/context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  cookies().delete(CLIENT_COOKIE_NAME);
  return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
}
