import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { LogoutButton } from "../_components/LogoutButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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

export default async function EventsPage() {
  const admin = await isAdminAuthenticated();
  if (!admin) {
    redirect("/admin/login?next=/admin/events");
  }

  const campaigns = await getCampaignRepository().listActiveCampaigns();

  // Distinct events across all clients, with a client count per event.
  const events = new Map<
    string,
    { eventId: string; eventName: string; dateRange: string; clients: string[] }
  >();
  for (const c of campaigns) {
    const existing = events.get(c.eventId);
    if (existing) {
      existing.clients.push(c.teamName);
    } else {
      events.set(c.eventId, {
        eventId: c.eventId,
        eventName: c.eventName,
        dateRange: formatDateRange(c.eventStartDate, c.eventEndDate),
        clients: [c.teamName]
      });
    }
  }

  return (
    <>
      <VdxHeader rightSlot={<LogoutButton />} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <Link
            href="/admin/campaigns"
            className="text-xs text-vdx-plum/60 hover:text-vdx-coral hover:underline"
          >
            &larr; All campaigns
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            Events
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Select an event to see every meeting booked across all clients.
          </p>
        </header>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-vdx-cream text-left text-[11px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3 font-semibold">Event</th>
                <th className="px-5 py-3 font-semibold">Dates</th>
                <th className="px-5 py-3 font-semibold">Clients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {[...events.values()].map((e) => (
                <tr key={e.eventId} className="transition-colors hover:bg-vdx-cream/40">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/admin/events/${encodeURIComponent(e.eventId)}`}
                      className="font-medium text-slate-900 hover:text-vdx-coral hover:underline"
                    >
                      {e.eventName}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{e.dateRange}</td>
                  <td className="px-5 py-3.5 text-slate-700">
                    {e.clients.length}{" "}
                    <span className="text-xs text-slate-400">
                      ({e.clients.join(", ")})
                    </span>
                  </td>
                </tr>
              ))}
              {events.size === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-slate-500">
                    No active events.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
