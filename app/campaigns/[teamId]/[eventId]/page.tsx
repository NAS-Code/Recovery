import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import {
  combineMeetingDateTime,
  listLeadsForCampaign,
  vendeluxStatusToBadge
} from "@/lib/integrations/leads.snowflake";
import { formatMeetingTime } from "@/lib/util/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  return (
    <main className="mx-auto max-w-6xl p-8">
      <Link
        href="/campaigns"
        className="text-xs text-slate-500 hover:underline"
      >
        ← All campaigns
      </Link>

      <header className="mt-2 mb-6">
        <h1 className="text-2xl font-semibold">{campaign.eventName}</h1>
        <p className="text-sm text-slate-500">
          {campaign.teamName} · {formatDateRange(campaign.eventStartDate, campaign.eventEndDate)}
          {" · "}
          {leads.length} {leads.length === 1 ? "lead" : "leads"} with meetings booked
        </p>
      </header>

      {leads.length === 0 ? (
        <p className="text-slate-600">
          No leads with positive status yet for this campaign.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Meeting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {leads.map((lead) => {
                const meetingDateTime = combineMeetingDateTime(lead);
                return (
                  <tr key={lead.leadId}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {lead.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {lead.title ?? "—"}
                        {lead.email ? ` · ${lead.email}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {lead.company ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {vendeluxStatusToBadge(lead.vendeluxStatus)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {meetingDateTime
                        ? formatMeetingTime(
                            meetingDateTime,
                            lead.meetingTimezone
                              ? abbreviationToIana(lead.meetingTimezone)
                              : undefined
                          )
                        : lead.meetingDate
                        ? lead.meetingDate.toISOString().slice(0, 10)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

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

function abbreviationToIana(abbrev: string): string | undefined {
  return TZ_ABBREV_TO_IANA[abbrev.toUpperCase()];
}
