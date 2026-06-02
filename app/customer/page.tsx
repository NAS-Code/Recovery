import { redirect } from "next/navigation";
import { getCampaignContext } from "@/lib/auth/campaign-context";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomerIndexPage() {
  // If a campaign client is logged in, send them to their dashboard
  const campaignCtx = await getCampaignContext();
  if (campaignCtx) {
    redirect(
      `/customer/${encodeURIComponent(campaignCtx.teamId)}/${encodeURIComponent(campaignCtx.eventId)}`
    );
  }

  // If admin, send to admin campaigns list
  const admin = await isAdminAuthenticated();
  if (admin) {
    redirect("/admin/campaigns");
  }

  // Not logged in — go to customer login
  redirect("/customer/login");
}
