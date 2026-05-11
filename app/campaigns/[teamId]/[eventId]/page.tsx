import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/app/_components/AutoRefresh";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  listLeadsForCampaign,
  vendeluxStatusToBadge
} from "@/lib/integrations/leads.snowflake";
import { formatMeetingTime } from "@/lib/util/format";
import { StatusBadge } from "@/app/dashboard/_components/StatusBadge";
import { MarkNoShowButton } from "../../_components/MarkNoShowButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TZ_ABBREV_TO_IANA: Record<string, string> = {
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "UTC"
};

function abbreviationToIana(abbrev: string | null): string | undefined {
  if (!abbrev) return undefined;
  return TZ_ABBREV_TO_IANA[abbrev.toUpperCase()];
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function CampaignDashboardPage({
  params
}: {
  params: { teamId: string; eventId: string };
}) {
  const teamId = decodeURIComponent(params.teamId);
  const eventId = decodeURIComponent(params.eventId);

  const [campaign, leads] = await Promise.all([
    getCampaignRepository().getCampaign(teamId, eventId),
    listLeadsForCampaign(teamId, eventId)
  ]);

  if (!campaign) notFound();

  const states = await getLeadRepository().getLeadStatesByVendeluxIds(
    leads.map((l) => l.leadId)
  );

  return (
    <>
      <VdxHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <AutoRefresh intervalMs={5000} />
        <Link
          href="/campaigns"
          className="text-xs text-vdx-plum/60 hover:text-vdx-coral hover:underline"
        >
          &larr; All campaigns
        </Link>

        <header className="mt-3 mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {campaign.eventName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {campaign.teamName} &middot; {formatDateRange(campaign.eventStartDate, campaign.eventEndDate)}
            {" · "}
            {leads.length} {leads.length === 1 ? "lead" : "leads"} with meetings booked
          </p>
        </header>

        {leads.length === 0 ? (
          <p className="text-slate-600">
            No leads with meetings booked for this campaign.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-vdx-cream text-left text-[11px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-semibold">Lead</th>
                  <th className="px-5 py-3 font-semibold">Company</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Meeting</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {leads.map((lead) => {
                  const concierge = states.get(lead.leadId);
                  const meetingDateTime =
                    concierge?.scheduledMeetingTime ??
                    combineMeetingDateTime(lead);
                  const meetingTimezone = abbreviationToIana(lead.meetingTimezone);
                  return (
                    <tr key={lead.leadId} className="transition-colors hover:bg-vdx-cream/40">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900">
                          {lead.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {lead.title ?? "—"}
                          {lead.email ? ` · ${lead.email}` : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">
                        {lead.company ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {concierge ? (
                          <StatusBadge status={concierge.status} />
                        ) : (
                          <span className="text-slate-700">
                            {vendeluxStatusToBadge(lead.vendeluxStatus)}
                          </span>
                        )}
                      </td>
                      <td className={`px-5 py-3.5 text-xs ${
                        concierge?.status === "confirmed_reschedule" || concierge?.status === "confirmed_virtual"
                          ? "font-medium text-green-600"
                          : "text-slate-700"
                      }`}>
                        {meetingDateTime
                          ? formatMeetingTime(meetingDateTime, meetingTimezone)
                          : lead.meetingDate
                          ? lead.meetingDate.toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {!concierge && lead.phone ? (
                          <MarkNoShowButton
                            teamId={teamId}
                            eventId={eventId}
                            vendeluxLeadId={lead.leadId}
                          />
                        ) : !concierge && !lead.phone ? (
                          <span className="text-[11px] text-slate-400">
                            no phone
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
