/**
 * Server-component helper to read and validate the campaign session cookie.
 * Returns { teamId, eventId } if valid, or null if not authenticated.
 */
import { cookies } from "next/headers";
import {
  CAMPAIGN_COOKIE_NAME,
  validateCampaignSession,
  type CampaignSessionPayload
} from "./campaign-auth";

export type CampaignContext = Pick<
  CampaignSessionPayload,
  "teamId" | "eventId" | "label"
>;

export async function getCampaignContext(): Promise<CampaignContext | null> {
  const token = cookies().get(CAMPAIGN_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await validateCampaignSession(token);
  if (!session) return null;

  return {
    teamId: session.teamId,
    eventId: session.eventId,
    label: session.label
  };
}
