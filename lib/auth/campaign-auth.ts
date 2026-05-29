/**
 * Campaign-level authentication: credential verification, session CRUD.
 *
 * Uses raw `pg` queries instead of Prisma to avoid the native engine binary
 * issue on Windows ARM. Works on all platforms.
 */
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

export const CAMPAIGN_COOKIE_NAME = "campaign_session";

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface CampaignSessionPayload {
  token: string;
  sessionId: string;
  credentialId: string;
  teamId: string;
  eventId: string;
  label: string | null;
}

function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set");
  // Reuse a module-level pool (Node caches the module)
  if (!(globalThis as any).__campaignAuthPool) {
    (globalThis as any).__campaignAuthPool = new pg.Pool({
      connectionString,
      max: 3
    });
  }
  return (globalThis as any).__campaignAuthPool;
}

function cuid(): string {
  return `c${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

export async function verifyCampaignCredential(
  username: string,
  password: string
): Promise<CampaignSessionPayload | null> {
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT id, username, password_hash, team_id, event_id, label
     FROM campaign_credentials WHERE username = $1 LIMIT 1`,
    [username]
  );

  if (rows.length === 0) return null;
  const cred = rows[0];

  const ok = await bcrypt.compare(password, cred.password_hash);
  if (!ok) return null;

  const token = randomBytes(32).toString("hex");
  const sessionId = cuid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO campaign_sessions (id, token, credential_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [sessionId, token, cred.id, expiresAt]
  );

  return {
    token,
    sessionId,
    credentialId: cred.id,
    teamId: cred.team_id,
    eventId: cred.event_id,
    label: cred.label,
  };
}

/* ------------------------------------------------------------------ */
/*  Session validation                                                 */
/* ------------------------------------------------------------------ */

export async function validateCampaignSession(
  token: string
): Promise<CampaignSessionPayload | null> {
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.token, s.credential_id, s.expires_at,
            c.team_id, c.event_id, c.label
     FROM campaign_sessions s
     JOIN campaign_credentials c ON c.id = s.credential_id
     WHERE s.token = $1
     LIMIT 1`,
    [token]
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  if (new Date(row.expires_at) < new Date()) {
    // Expired — clean up
    await pool.query(`DELETE FROM campaign_sessions WHERE id = $1`, [row.session_id]).catch(() => {});
    return null;
  }

  return {
    token: row.token,
    sessionId: row.session_id,
    credentialId: row.credential_id,
    teamId: row.team_id,
    eventId: row.event_id,
    label: row.label,
  };
}

/* ------------------------------------------------------------------ */
/*  Logout                                                             */
/* ------------------------------------------------------------------ */

export async function destroyCampaignSession(token: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM campaign_sessions WHERE token = $1`, [token]);
}
