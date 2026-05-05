import Link from "next/link";
import { getCampaignRepository } from "@/lib/integrations/campaigns";

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

export default async function CampaignsPage() {
  const repo = getCampaignRepository();
  const campaigns = await repo.listActiveCampaigns();

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Active campaigns</h1>
        <p className="text-sm text-slate-500">
          {campaigns.length} active · sourced from SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
        </p>
      </header>

      {campaigns.length === 0 ? (
        <p className="text-slate-600">No active campaigns.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {campaigns.map((c) => (
                <tr key={`${c.teamId}_${c.eventId}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {c.teamName}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${encodeURIComponent(c.teamId)}/${encodeURIComponent(c.eventId)}`}
                      className="text-slate-900 hover:underline"
                    >
                      {c.eventName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDateRange(c.eventStartDate, c.eventEndDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
