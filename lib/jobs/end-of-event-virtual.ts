import { buildVirtualOfferSms } from "@/lib/core/outbound-templates";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { logger } from "@/lib/util/logger";

const LOOKBACK_HOURS = 36;

export interface EndOfEventVirtualResult {
  eventsProcessed: number;
  candidates: number;
  smsSent: number;
  smsFailed: number;
  skippedAlreadyOffered: number;
}

const VIRTUAL_OFFER_MARKER = "virtual meeting next week";

export async function runEndOfEventVirtual(
  now: Date = new Date()
): Promise<EndOfEventVirtualResult> {
  const repo = getLeadRepository();
  const events = await repo.getRecentlyEndedEvents(now, LOOKBACK_HOURS);

  if (events.length === 0) {
    logger.info("cron.end_of_event_virtual.no_events");
    return {
      eventsProcessed: 0,
      candidates: 0,
      smsSent: 0,
      smsFailed: 0,
      skippedAlreadyOffered: 0
    };
  }

  let candidates = 0;
  let smsSent = 0;
  let smsFailed = 0;
  let skippedAlreadyOffered = 0;

  for (const event of events) {
    const leads = await repo.getActiveNoShows(event.id);
    candidates += leads.length;

    for (const lead of leads) {
      const history = await repo.getConversationHistory(lead.id);
      const alreadyOffered = history.some(
        (m) =>
          m.direction === "outbound" && m.text.includes(VIRTUAL_OFFER_MARKER)
      );
      if (alreadyOffered) {
        skippedAlreadyOffered++;
        continue;
      }

      const body = buildVirtualOfferSms(lead);
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
        logger.error("cron.end_of_event_virtual.sms_failed", {
          leadId: lead.id,
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  const result: EndOfEventVirtualResult = {
    eventsProcessed: events.length,
    candidates,
    smsSent,
    smsFailed,
    skippedAlreadyOffered
  };

  logger.info("cron.end_of_event_virtual.done", { ...result });
  return result;
}
