import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { VdxHeader } from "@/app/_components/VdxHeader";
import {
  CampaignsTable,
  type CampaignRowData
} from "./_components/CampaignsTable";

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

  const rows: CampaignRowData[] = campaigns.map((c) => ({
    teamId: c.teamId,
    teamName: c.teamName,
    eventId: c.eventId,
    eventName: c.eventName,
    dateRange: formatDateRange(c.eventStartDate, c.eventEndDate)
  }));

  return (
    <>
      <VdxHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Active Campaigns
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Select a campaign to view meetings booked and manage no-show recovery.
          </p>
        </header>

        <CampaignsTable campaigns={rows} />
      </main>
    </>
  );
}
