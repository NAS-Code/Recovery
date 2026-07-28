import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  listLeadsForCampaign
} from "@/lib/integrations/leads.snowflake";

/**
 * Effective booked-meeting times for a campaign, used for overlap checks.
 * Starts from the Snowflake "Meeting Booked" list, then overlays our Postgres
 * concierge state: if a lead has a concierge record its scheduledMeetingTime
 * wins (it may be a confirmed reschedule); otherwise use the original booked
 * time. Excludes the lead being rescheduled.
 *
 * Lives in its own module (not leads.snowflake) so that the Snowflake helpers
 * stay free of the Prisma dependency this pulls in via the repository.
 */
export async function getCampaignMeetingTimes(
  teamId: string,
  eventId: string,
  excludeVendeluxLeadId: string
): Promise<Date[]> {
  const leads = await listLeadsForCampaign(teamId, eventId);
  const states = await getLeadRepository().getLeadStatesByVendeluxIds(
    leads.map((l) => l.leadId)
  );

  const times: Date[] = [];
  for (const lead of leads) {
    if (lead.leadId === excludeVendeluxLeadId) continue;
    const concierge = states.get(lead.leadId);
    const t = concierge?.scheduledMeetingTime ?? combineMeetingDateTime(lead);
    if (t) times.push(t);
  }
  return times;
}
