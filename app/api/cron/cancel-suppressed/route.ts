import { NextResponse, type NextRequest } from "next/server";
import { getLeadRepository } from "@/lib/integrations/data";
import { verifyCronAuth } from "@/lib/util/cron-auth";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

const SUPPRESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - SUPPRESSION_TTL_MS);
  const count = await getLeadRepository().cancelExpiredSuppressions(cutoff);

  if (count > 0) {
    logger.info("cron.cancel_suppressed.done", { canceled: count });
  }

  return NextResponse.json({ canceled: count });
}
