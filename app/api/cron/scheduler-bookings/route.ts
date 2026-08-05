import { NextResponse, type NextRequest } from "next/server";
import { runSchedulerBookingSync } from "@/lib/jobs/scheduler-bookings";
import { verifyCronAuth } from "@/lib/util/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerBookingSync();
  return NextResponse.json(result);
}
