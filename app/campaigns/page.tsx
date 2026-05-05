import { getCampaignRepository } from "@/lib/integrations/campaigns";
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
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Active campaigns</h1>
        <p className="text-sm text-slate-500">
          Sourced live from SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
        </p>
      </header>

      <CampaignsTable campaigns={rows} />
    </main>
  );
}
