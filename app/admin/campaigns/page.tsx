import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";
import { ensureAllCampaignCredentials, type CampaignCredentialInfo } from "@/lib/auth/campaign-credentials";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { LogoutButton } from "../_components/LogoutButton";
import {
  CampaignsTable,
  type CampaignRowData
} from "../_components/CampaignsTable";

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

export default async function CampaignsPage() {
  // Campaigns list is admin-only
  const admin = await isAdminAuthenticated();
  if (!admin) {
    redirect("/admin/login?next=/admin/campaigns");
  }

  const repo = getCampaignRepository();
  const campaigns = await repo.listActiveCampaigns();

  // Auto-generate credentials for every campaign (idempotent)
  const credMap = await ensureAllCampaignCredentials(
    campaigns.map((c) => ({
      teamId: c.teamId,
      eventId: c.eventId,
      teamName: c.teamName
    }))
  );

  const rows: CampaignRowData[] = campaigns.map((c) => {
    const key = `${c.teamId}:${c.eventId}`;
    const cred = credMap.get(key);
    return {
      teamId: c.teamId,
      teamName: c.teamName,
      eventId: c.eventId,
      eventName: c.eventName,
      dateRange: formatDateRange(c.eventStartDate, c.eventEndDate),
      clientUsername: cred?.username ?? null,
      clientPassword: cred?.password ?? null
    };
  });

  return (
    <>
      <VdxHeader rightSlot={<LogoutButton />} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Active Campaigns
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Select a campaign to view meetings booked and manage no-show
                recovery. Client login credentials are auto-generated per campaign.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href="/admin/events"
                className="rounded-md bg-vdx-plum px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-vdx-coral"
              >
                Event View
              </Link>
              <Link
                href="/admin/activity"
                className="rounded-md bg-vdx-plum px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-vdx-coral"
              >
                SMS Activity
              </Link>
            </div>
          </div>
        </header>

        <CampaignsTable campaigns={rows} />
      </main>
    </>
  );
}
