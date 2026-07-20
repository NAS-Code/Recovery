import Link from "next/link";
import { redirect } from "next/navigation";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";
import { ACTIVE_NO_SHOW_STATUSES } from "@/lib/core/types";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  listLeadsForEventAllTeams,
  vendeluxStatusToBadge
} from "@/lib/integrations/leads.snowflake";
import { formatMeetingTime } from "@/lib/util/format";
import { StatusBadge } from "@/app/dashboard/_components/StatusBadge";
import { LogoutButton } from "../../_components/LogoutButton";
import { ManualRebookButton } from "../_components/ManualRebookButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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

export default async function EventMeetingsPage({
  params
}: {
  params: { eventId: string };
}) {
  const eventId = decodeURIComponent(params.eventId);

  // Cross-client view — strictly admin-only.
  const admin = await isAdminAuthenticated();
  if (!admin) {
    redirect(`/admin/login?next=/admin/events/${encodeURIComponent(eventId)}`);
  }

  const campaigns = await getCampaignRepository().listActiveCampaigns();
  const eventCampaigns = campaigns.filter((c) => c.eventId === eventId);

  const leads = await listLeadsForEventAllTeams(
    eventId,
    eventCampaigns.map((c) => ({ teamId: c.teamId, teamName: c.teamName }))
  );
  const states = await getLeadRepository().getLeadStatesByVendeluxIds(
    leads.map((l) => l.leadId)
  );

  const eventName = eventCampaigns[0]?.eventName ?? null;
  const eventStart = leads.find((l) => l.eventStartDate)?.eventStartDate ?? null;
  const eventEnd = leads.find((l) => l.eventEndDate)?.eventEndDate ?? null;
  const dateRange =
    eventStart && eventEnd
      ? `${eventStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${eventEnd.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}`
      : null;

  const clientCount = new Set(leads.map((l) => l.teamId)).size;

  return (
    <>
      <VdxHeader rightSlot={<LogoutButton />} />
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href="/admin/events"
          className="text-xs text-vdx-plum/60 hover:text-vdx-coral hover:underline"
        >
          &larr; All events
        </Link>
        <header className="mt-3 mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {eventName ?? "Event meetings"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {dateRange ? `${dateRange} · ` : ""}
            {clientCount} {clientCount === 1 ? "client" : "clients"} ·{" "}
            {leads.length} {leads.length === 1 ? "meeting" : "meetings"} booked
          </p>
        </header>

        {leads.length === 0 ? (
          <p className="text-slate-600">
            No meetings booked for this event.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-vdx-cream text-left text-[11px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-semibold">Client</th>
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
                  const meetingTimezone = abbreviationToIana(
                    lead.meetingTimezone
                  );
                  return (
                    <tr
                      key={lead.leadId}
                      className="transition-colors hover:bg-vdx-cream/40"
                    >
                      <td className="px-5 py-3.5">
                        {/* Plain <a>: full navigation, immune to the AutoRefresh
                            race that can swallow client-side Link transitions
                            while the (slow, Snowflake-backed) target renders. */}
                        <a
                          href={`/customer/${encodeURIComponent(lead.teamId)}/${encodeURIComponent(eventId)}`}
                          className="font-medium text-vdx-plum hover:text-vdx-coral hover:underline"
                        >
                          {lead.teamName ?? "—"}
                        </a>
                      </td>
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
                      <td
                        className={`px-5 py-3.5 text-xs ${
                          concierge?.status === "confirmed_reschedule" ||
                          concierge?.status === "confirmed_virtual"
                            ? "font-medium text-green-600"
                            : "text-slate-700"
                        }`}
                      >
                        {meetingDateTime
                          ? formatMeetingTime(meetingDateTime, meetingTimezone)
                          : lead.meetingDate
                            ? lead.meetingDate.toISOString().slice(0, 10)
                            : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <ManualRebookButton
                          leadId={concierge?.id ?? null}
                          disabledReason={
                            !concierge
                              ? "Lead is not in the concierge system (not marked no-show)"
                              : ACTIVE_NO_SHOW_STATUSES.includes(concierge.status)
                                ? null
                                : `Lead is ${concierge.status.replace(/_/g, " ")} — nothing to rebook`
                          }
                        />
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
