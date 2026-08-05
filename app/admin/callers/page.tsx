import Link from "next/link";
import { redirect } from "next/navigation";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";
import { getLeadRepository } from "@/lib/integrations/data";
import { getBookingLinksForEvent } from "@/lib/integrations/leads.snowflake";
import { formatMeetingTime } from "@/lib/util/format";
import { StatusBadge } from "@/app/dashboard/_components/StatusBadge";
import { LogoutButton } from "../_components/LogoutButton";
import { ManualRebookButton } from "../events/_components/ManualRebookButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export default async function CallerViewPage() {
  // Cross-client worklist — strictly admin-only.
  const admin = await isAdminAuthenticated();
  if (!admin) {
    redirect("/admin/login?next=/admin/callers");
  }

  const repo = getLeadRepository();
  const leads = await repo.getNoShowLeads();

  const eventIds = [...new Set(leads.map((l) => l.eventId))];
  const [clients, events] = await Promise.all([
    repo.listClients(),
    repo.getEventsByIds(eventIds)
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const eventTz = new Map(events.map((e) => [e.id, e.timezone]));

  // Booking links keyed by `teamId::eventId` — one Snowflake query per event.
  const bookingLinks = new Map<string, string>();
  await Promise.all(
    eventIds.map(async (eventId) => {
      const teamIds = [
        ...new Set(
          leads.filter((l) => l.eventId === eventId).map((l) => l.clientId)
        )
      ];
      const links = await getBookingLinksForEvent(eventId, teamIds);
      for (const [teamId, link] of links) {
        bookingLinks.set(`${teamId}::${eventId}`, link);
      }
    })
  );

  return (
    <>
      <VdxHeader rightSlot={<LogoutButton />} />
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href="/admin/campaigns"
          className="text-xs text-vdx-plum/60 hover:text-vdx-coral hover:underline"
        >
          &larr; All campaigns
        </Link>
        <header className="mt-3 mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Caller View
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every lead currently in no-show status, across all clients and
            events. {leads.length} {leads.length === 1 ? "lead" : "leads"}.
          </p>
        </header>

        {leads.length === 0 ? (
          <p className="text-slate-600">No leads in no-show status right now.</p>
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
                  const link = bookingLinks.get(
                    `${lead.clientId}::${lead.eventId}`
                  );
                  return (
                    <tr
                      key={lead.id}
                      className="transition-colors hover:bg-vdx-cream/40"
                    >
                      <td className="px-5 py-3.5">
                        <a
                          href={`/customer/${encodeURIComponent(lead.clientId)}/${encodeURIComponent(lead.eventId)}`}
                          className="font-medium text-vdx-plum hover:text-vdx-coral hover:underline"
                        >
                          {clientName.get(lead.clientId) ?? "—"}
                        </a>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900">
                          {lead.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {lead.email ?? "—"}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">
                        {lead.company ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-700">
                        {lead.scheduledMeetingTime
                          ? formatMeetingTime(
                              lead.scheduledMeetingTime,
                              eventTz.get(lead.eventId)
                            )
                          : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-start justify-end gap-2">
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 rounded-md border border-vdx-plum px-3 py-1.5 text-xs font-medium text-vdx-plum hover:bg-vdx-cream"
                            >
                              Booking Link
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              title="No booking link configured for this campaign"
                              className="shrink-0 cursor-not-allowed rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400"
                            >
                              Booking Link
                            </button>
                          )}
                          <ManualRebookButton leadId={lead.id} />
                        </div>
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
