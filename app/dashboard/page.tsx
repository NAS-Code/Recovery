import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientContext } from "@/lib/auth/context";
import { getLeadRepository } from "@/lib/integrations/data";
import { formatMeetingTime } from "@/lib/util/format";
import { AutoRefresh } from "@/app/_components/AutoRefresh";
import { ClientHeader } from "./_components/ClientHeader";
import { MarkNoShowButton } from "./_components/MarkNoShowButton";
import { RescheduleApprovalButton } from "./_components/RescheduleApprovalButton";
import { StatusBadge } from "./_components/StatusBadge";

export const dynamic = "force-dynamic";

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function DashboardPage() {
  const ctx = getClientContext();
  if (!ctx) redirect("/sign-in");

  const repo = getLeadRepository();
  const [client, event] = await Promise.all([
    repo.getClient(ctx.clientId),
    repo.getCurrentEventForClient(ctx.clientId)
  ]);

  if (!client) redirect("/sign-in");

  return (
    <main className="mx-auto max-w-5xl p-8">
      <AutoRefresh intervalMs={5000} />
      <ClientHeader clientName={client.name} />

      {!event ? (
        <p className="text-slate-600">No events for this client yet.</p>
      ) : (
        <DashboardBody clientId={ctx.clientId} eventId={event.id} eventName={event.name} startDate={event.startDate} endDate={event.endDate} timezone={event.timezone} />
      )}
    </main>
  );
}

async function DashboardBody({
  clientId,
  eventId,
  eventName,
  startDate,
  endDate,
  timezone
}: {
  clientId: string;
  eventId: string;
  eventName: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
}) {
  const repo = getLeadRepository();
  const allLeads = await repo.getLeadsForEvent(eventId);
  const leads = allLeads.filter((l) => l.clientId === clientId);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{eventName}</h1>
        <p className="text-sm text-slate-500">
          {formatDateRange(startDate, endDate)} · {leads.length} leads
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Meeting</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/${lead.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {lead.name}
                  </Link>
                  <div className="text-xs text-slate-500">{lead.phone}</div>
                </td>
                <td className="px-4 py-3 text-slate-700">{lead.company ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className={`px-4 py-3 text-xs ${
                  lead.status === "confirmed_reschedule" || lead.status === "confirmed_virtual"
                    ? "font-medium text-green-600"
                    : "text-slate-700"
                }`}>
                  {formatMeetingTime(lead.scheduledMeetingTime, timezone)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {lead.updatedAt.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {lead.status === "pending_client_approval" &&
                  lead.proposedMeetingTime ? (
                    <RescheduleApprovalButton
                      leadId={lead.id}
                      proposedLabel={formatMeetingTime(
                        lead.proposedMeetingTime,
                        timezone
                      )}
                    />
                  ) : lead.status === "scheduled" ? (
                    <MarkNoShowButton leadId={lead.id} />
                  ) : null}
                </td>
              </tr>
            ))}
            {leads.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No leads for this event.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
