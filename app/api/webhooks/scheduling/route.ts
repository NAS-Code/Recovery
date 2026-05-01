import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TERMINAL_STATUSES, type Lead } from "@/lib/core/types";
import { getLeadRepository } from "@/lib/integrations/data";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

const payloadSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    newMeetingTime: z.string().datetime().optional(),
    providerEventId: z.string().optional()
  })
  .refine((d) => d.leadId !== undefined || d.phone !== undefined, {
    message: "either leadId or phone is required"
  });

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("scheduling.webhook.invalid_payload", {
      error: parsed.error.message
    });
    return NextResponse.json(
      { error: "invalid_payload", detail: parsed.error.message },
      { status: 400 }
    );
  }

  const { leadId, phone, newMeetingTime, providerEventId } = parsed.data;
  const repo = getLeadRepository();

  const lead = await resolveLead(leadId, phone);
  if (!lead) {
    logger.warn("scheduling.webhook.lead_not_found", {
      leadId,
      phone,
      providerEventId
    });
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  if (TERMINAL_STATUSES.includes(lead.status)) {
    logger.info("scheduling.webhook.noop_terminal", {
      leadId: lead.id,
      currentStatus: lead.status
    });
    return NextResponse.json({
      leadId: lead.id,
      status: lead.status,
      changed: false
    });
  }

  if (newMeetingTime) {
    await repo.updateScheduledMeetingTime(lead.id, new Date(newMeetingTime));
  }

  await repo.updateLeadStatus(lead.id, "confirmed_reschedule");

  logger.info("scheduling.webhook.confirmed", {
    leadId: lead.id,
    eventId: lead.eventId,
    fromStatus: lead.status,
    newMeetingTime: newMeetingTime ?? null,
    providerEventId: providerEventId ?? null
  });

  return NextResponse.json({
    leadId: lead.id,
    status: "confirmed_reschedule",
    changed: true
  });
}

async function resolveLead(
  leadId: string | undefined,
  phone: string | undefined
): Promise<Lead | null> {
  const repo = getLeadRepository();
  if (leadId) {
    const byId = await repo.getLead(leadId);
    if (byId) return byId;
  }
  if (phone) {
    return repo.getActiveLeadByPhone(phone);
  }
  return null;
}
