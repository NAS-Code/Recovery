import { NextResponse, type NextRequest } from "next/server";
import { getLeadRepository } from "@/lib/integrations/data";
import { verifyServiceToken } from "@/lib/util/service-auth";

/**
 * Read-only no-show feed for the-lookout's Follow-Ups tab.
 *
 * Service-to-service only — the caller is the-lookout's own serverless
 * function, never a browser, so this is bearer-token auth rather than one of
 * the cookie sessions in lib/auth. Set LOOKOUT_API_TOKEN in both apps.
 *
 * "Active no-show" here means ACTIVE_NO_SHOW_STATUSES, not just `no_show` —
 * a lead mid-reschedule is still an unresolved no-show from the caller's point
 * of view. getActiveNoShows() owns that definition and also drops silently
 * suppressed leads, so this route deliberately adds no filtering of its own:
 * one definition of "active", in lib/core/types.
 *
 * Phone and email are omitted on purpose. The caller renders names for
 * recognition and links back here for the real per-lead state, so there is no
 * reason to widen the PII crossing the boundary. Don't add them without a
 * concrete need.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyServiceToken(req.headers.get("authorization"), process.env.LOOKOUT_API_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repo = getLeadRepository();
  const eventId = req.nextUrl.searchParams.get("eventId") ?? undefined;

  const [leads, clients] = await Promise.all([
    repo.getActiveNoShows(eventId),
    repo.listClients()
  ]);
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  return NextResponse.json(
    {
      ok: true,
      count: leads.length,
      leads: leads.map((lead) => ({
        id: lead.id,
        sourceLeadId: lead.sourceLeadId,
        name: lead.name,
        company: lead.company,
        clientId: lead.clientId,
        clientName: clientNameById.get(lead.clientId) ?? null,
        // eventId only — resolving event names would need a bulk lookup on
        // LeadRepository, which is a deliberate change rather than a drive-by.
        eventId: lead.eventId,
        status: lead.status,
        scheduledMeetingTime: lead.scheduledMeetingTime,
        updatedAt: lead.updatedAt
      }))
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
