import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_COOKIE_NAME } from "@/lib/auth/context";
import { getLeadRepository } from "@/lib/integrations/data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || clientId.length === 0) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const client = await getLeadRepository().getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  cookies().set(CLIENT_COOKIE_NAME, client.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  const next = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  return NextResponse.redirect(new URL(next, req.url), { status: 303 });
}
