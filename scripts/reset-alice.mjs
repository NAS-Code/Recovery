// Reset Alice Johnson for a fresh test run — runs directly in PowerShell (no WSL).
// Usage: node scripts/reset-alice.mjs

import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.vercel.production");
const envText = readFileSync(envPath, "utf8");
const dbLine = envText.split("\n").find((l) => l.startsWith("DATABASE_URL="));
if (!dbLine) {
  console.error("DATABASE_URL not found in .env.vercel.production");
  process.exit(1);
}
const connStr = dbLine.split("=").slice(1).join("=").replace(/^"|"$/g, "");

const pool = new pg.Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

try {
  // 1. Find Alice
  const { rows: [alice] } = await pool.query(
    `SELECT id, name, status, event_id FROM leads WHERE name = 'Alice Johnson' LIMIT 1`
  );
  if (!alice) { console.error("Alice not found"); process.exit(1); }
  console.log("Found Alice:", alice.id);

  // 2. Delete conversation history
  const del = await pool.query(`DELETE FROM conversations WHERE lead_id = $1`, [alice.id]);
  console.log("Conversations deleted:", del.rowCount);

  // 3. Reset lead status, clear fdeOwnerSlackId, set meeting ~1hr from now
  const meetingTime = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    `UPDATE leads SET status = 'scheduled', scheduled_meeting_time = $1, fde_owner_slack_id = 'U0AK6M6CJ7J' WHERE id = $2`,
    [meetingTime.toISOString(), alice.id]
  );
  console.log("Lead reset to scheduled, fdeOwnerSlackId cleared, meeting at:", meetingTime.toISOString());

  // 4. Update event to Consensus 2026
  await pool.query(
    `UPDATE events SET name = 'Consensus 2026', start_date = $1, end_date = $2, timezone = 'America/New_York' WHERE id = $3`,
    [new Date("2026-05-04T00:00:00Z").toISOString(), new Date("2026-05-08T23:59:59Z").toISOString(), alice.event_id]
  );
  console.log("Event updated to Consensus 2026");

  console.log("\nReady to test! Go to /dashboard and click Mark no-show.");
} finally {
  await pool.end();
}
