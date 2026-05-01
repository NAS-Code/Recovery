import { NextResponse, type NextRequest } from "next/server";
import { runEodCheckin } from "@/lib/jobs/eod-checkin";
import { verifyCronAuth } from "@/lib/util/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runEodCheckin();
  return NextResponse.json(result);
}
