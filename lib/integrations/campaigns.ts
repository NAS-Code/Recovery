import type { Campaign } from "@/lib/core/types";
import { SnowflakeCampaignRepository } from "@/lib/integrations/campaigns.snowflake";

export interface CampaignRepository {
  listActiveCampaigns(now?: Date): Promise<Campaign[]>;
  getCampaign(teamId: string, eventId: string): Promise<Campaign | null>;
}

let repository: CampaignRepository | null = null;

export function getCampaignRepository(): CampaignRepository {
  if (!repository) {
    repository = new SnowflakeCampaignRepository();
  }
  return repository;
}

export function setCampaignRepository(repo: CampaignRepository): void {
  repository = repo;
}
