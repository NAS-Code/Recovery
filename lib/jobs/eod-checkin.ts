import { buildEodCheckinSms } from "@/lib/core/outbound-templates";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { logger } from "@/lib/util/logger";

export interface EodCheckinResult {
  eventId: string | null;
  candidates: number;
  skippedMidConversation: number;
  smsSent: number;
  smsFailed: number;
}

export async function runEodCheckin(
  now: Date = new Date()
): Promise<EodCheckinResult> {
  const repo = getLeadRepository();

  const event = await repo.getCurrentEvent(now);
  if (!event) {
    logger.info("cron.eod_checkin.no_event");
    return {
      eventId: null,
      candidates: 0,
      skippedMidConversation: 0,
      smsSent: 0,
      smsFailed: 0
    };
  }

  if (now < event.startDate || now > event.endDate) {
    logger.info("cron.eod_checkin.event_not_running", { eventId: event.id });
    return {
      eventId: event.id,
      candidates: 0,
      skippedMidConversation: 0,
      smsSent: 0,
      smsFailed: 0
    };
  }

  const [active, midConvo] = await Promise.all([
    repo.getActiveNoShows(event.id),
    repo.getMidConversationLeads(now)
  ]);

  const midConvoIds = new Set(midConvo.map((l) => l.id));
  const targets = active.filter((l) => !midConvoIds.has(l.id));

  let smsSent = 0;
  let smsFailed = 0;

  for (const lead of targets) {
    const body = buildEodCheckinSms(lead);
    try {
      await sendSms({ to: lead.phone, body, leadId: lead.id });
      await repo.appendMessage({
        leadId: lead.id,
        direction: "outbound",
        text: body
      });
      smsSent++;
    } catch (err) {
      smsFailed++;
      logger.error("cron.eod_checkin.sms_failed", {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const result: EodCheckinResult = {
    eventId: event.id,
    candidates: active.length,
    skippedMidConversation: active.length - targets.length,
    smsSent,
    smsFailed
  };

  logger.info("cron.eod_checkin.done", { ...result });
  return result;
}
