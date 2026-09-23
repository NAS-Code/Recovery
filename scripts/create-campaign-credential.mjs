/**
 * Create a campaign credential for a client (manual override).
 *
 * Usage:
 *   node scripts/create-campaign-credential.mjs <username> <password> <teamId> <eventId> [label]
 *
 * NOTE: Credentials are now auto-generated when an admin views the campaigns page.
 * This script is only needed for manual overrides (e.g. custom username or password).
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

const [username, password, teamId, eventId, label] = process.argv.slice(2);

if (!username || !password || !teamId || !eventId) {
  console.error(
    "Usage: node scripts/create-campaign-credential.mjs <username> <password> <teamId> <eventId> [label]"
  );
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/noshow_recovery";

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const hash = await bcrypt.hash(password, 12);
  const id = generateCuid();

  const result = await pool.query(
    `INSERT INTO campaign_credentials (id, username, password_hash, password_plain, team_id, event_id, label, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       password_plain = EXCLUDED.password_plain,
       team_id = EXCLUDED.team_id,
       event_id = EXCLUDED.event_id,
       label = EXCLUDED.label
     RETURNING id, username, team_id, event_id, label`,
    [id, username, hash, password, teamId, eventId, label || null]
  );

  const row = result.rows[0];
  console.log("\nCampaign credential created/updated:");
  console.log(`  ID:       ${row.id}`);
  console.log(`  Username: ${row.username}`);
  console.log(`  Team ID:  ${row.team_id}`);
  console.log(`  Event ID: ${row.event_id}`);
  console.log(`  Label:    ${row.label || "(none)"}`);
  console.log(`\nDashboard URL: /customer/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}`);
  console.log(`\nShare with the client:`);
  console.log(`  URL:      <your-domain>/customer/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
}

function generateCuid() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `c${timestamp}${random}`;
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
