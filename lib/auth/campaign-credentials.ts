/**
 * Auto-generates campaign credentials for client dashboard access.
 *
 * Uses raw `pg` queries instead of Prisma to avoid the native engine binary
 * issue on Windows ARM.
 */
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

export interface CampaignCredentialInfo {
  username: string;
  password: string;
  teamId: string;
  eventId: string;
}

function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set");
  if (!(globalThis as any).__campaignCredPool) {
    (globalThis as any).__campaignCredPool = new pg.Pool({
      connectionString,
      max: 3
    });
  }
  return (globalThis as any).__campaignCredPool;
}

function cuid(): string {
  return `c${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

/**
 * Sanitize a team/company name into a URL-safe username slug.
 * e.g. "Acme Corp" → "acme-corp-user"
 */
function toUsernameSlug(teamName: string): string {
  return (
    teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + "-user"
  );
}

/** Generate a random 12-character alphanumeric password. */
function generatePassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

/**
 * Ensure a credential exists for the given campaign.
 * Returns the credential info (including plaintext password for admin display).
 * Idempotent — won't regenerate if one already exists for this (teamId, eventId).
 */
export async function ensureCampaignCredential(
  teamId: string,
  eventId: string,
  teamName: string
): Promise<CampaignCredentialInfo> {
  const pool = getPool();

  // Check if credential already exists for this campaign
  const { rows: existing } = await pool.query(
    `SELECT username, password_plain, team_id, event_id
     FROM campaign_credentials WHERE team_id = $1 AND event_id = $2 LIMIT 1`,
    [teamId, eventId]
  );

  if (existing.length > 0) {
    return {
      username: existing[0].username,
      password: existing[0].password_plain,
      teamId: existing[0].team_id,
      eventId: existing[0].event_id,
    };
  }

  // Generate new credential
  let username = toUsernameSlug(teamName);
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  // Handle username collision (different campaign, same team name slug)
  const { rows: collision } = await pool.query(
    `SELECT id FROM campaign_credentials WHERE username = $1 LIMIT 1`,
    [username]
  );
  if (collision.length > 0) {
    username =
      username.replace(/-user$/, "") +
      "-" +
      randomBytes(2).toString("hex") +
      "-user";
  }

  const id = cuid();
  await pool.query(
    `INSERT INTO campaign_credentials (id, username, password_hash, password_plain, team_id, event_id, label, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (team_id, event_id) DO NOTHING`,
    [id, username, passwordHash, password, teamId, eventId, teamName]
  );

  // Re-read in case of race condition (ON CONFLICT DO NOTHING)
  const { rows: final } = await pool.query(
    `SELECT username, password_plain, team_id, event_id
     FROM campaign_credentials WHERE team_id = $1 AND event_id = $2 LIMIT 1`,
    [teamId, eventId]
  );

  return {
    username: final[0].username,
    password: final[0].password_plain,
    teamId: final[0].team_id,
    eventId: final[0].event_id,
  };
}

/**
 * Batch-ensure credentials for multiple campaigns.
 * Returns a Map keyed by "teamId:eventId".
 */
export async function ensureAllCampaignCredentials(
  campaigns: Array<{ teamId: string; eventId: string; teamName: string }>
): Promise<Map<string, CampaignCredentialInfo>> {
  const pool = getPool();
  const result = new Map<string, CampaignCredentialInfo>();

  if (campaigns.length === 0) return result;

  // Fetch all existing credentials in one query
  const conditions = campaigns
    .map((_, i) => `(team_id = $${i * 2 + 1} AND event_id = $${i * 2 + 2})`)
    .join(" OR ");
  const params = campaigns.flatMap((c) => [c.teamId, c.eventId]);

  const { rows: existing } = await pool.query(
    `SELECT username, password_plain, team_id, event_id
     FROM campaign_credentials WHERE ${conditions}`,
    params
  );

  const existingMap = new Map(
    existing.map((e: any) => [`${e.team_id}:${e.event_id}`, e])
  );

  for (const campaign of campaigns) {
    const key = `${campaign.teamId}:${campaign.eventId}`;
    const ex = existingMap.get(key);

    if (ex) {
      result.set(key, {
        username: ex.username,
        password: ex.password_plain,
        teamId: ex.team_id,
        eventId: ex.event_id,
      });
    } else {
      // Generate one at a time (rare — only for brand-new campaigns)
      const cred = await ensureCampaignCredential(
        campaign.teamId,
        campaign.eventId,
        campaign.teamName
      );
      result.set(key, cred);
    }
  }

  return result;
}
