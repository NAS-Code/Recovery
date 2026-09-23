import type { Campaign } from "@/lib/core/types";
import type { CampaignRepository } from "@/lib/integrations/campaigns";
import { query } from "@/lib/integrations/snowflake";

interface CampaignRow {
  EXTERNAL_CAMPAIGN_ID: string;
  TEAM_ID: string;
  TEAM_NAME: string;
  EVENT_ID: string;
  EVENT_NAME: string;
  EVENT_DATE_START: Date;
  EVENT_DATE_END: Date;
}

function toDomain(row: CampaignRow): Campaign {
  return {
    externalCampaignId: row.EXTERNAL_CAMPAIGN_ID,
    teamId: row.TEAM_ID,
    teamName: row.TEAM_NAME,
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME,
    eventStartDate: new Date(row.EVENT_DATE_START),
    eventEndDate: new Date(row.EVENT_DATE_END)
  };
}

const CAMPAIGN_COLUMNS = `
  external_campaign_id   AS "EXTERNAL_CAMPAIGN_ID",
  team_id           AS "TEAM_ID",
  team_name         AS "TEAM_NAME",
  event_id          AS "EVENT_ID",
  event_name        AS "EVENT_NAME",
  event_date_start  AS "EVENT_DATE_START",
  event_date_end    AS "EVENT_DATE_END"
`;

export class SnowflakeCampaignRepository implements CampaignRepository {
  async listActiveCampaigns(now: Date = new Date()): Promise<Campaign[]> {
    const isoDate = now.toISOString().slice(0, 10);
    const rows = await query<CampaignRow>(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM ANALYTICS.CONCIERGE.V_CAMPAIGN_CONFIG
       WHERE event_date_end >= ?
       ORDER BY event_date_start ASC, team_name ASC`,
      [isoDate]
    );
    return rows.map(toDomain);
  }

  async getCampaign(
    teamId: string,
    eventId: string
  ): Promise<Campaign | null> {
    const rows = await query<CampaignRow>(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM ANALYTICS.CONCIERGE.V_CAMPAIGN_CONFIG
       WHERE team_id = ? AND event_id = ?
       LIMIT 1`,
      [teamId, eventId]
    );
    return rows.length > 0 ? toDomain(rows[0]) : null;
  }
}
