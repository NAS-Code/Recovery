// Debug script: why doesn't a campaign show up on /campaigns?
//
// Checks:
// 1. Total vs active campaigns in V_VDX_CAMPAIGN_CONFIG
// 2. All campaigns with event_date_end near today (shows recently expired too)
// 3. Campaigns containing "SaaStr" (or whatever search term you pass)
//
// Run from WSL:
//   node /mnt/c/Users/n1sar/VDX/scripts/debug-missing-campaign.mjs [search-term]

import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";

const CREDS_PATH = "/mnt/c/Users/n1sar/vdxCreds/snowflakeCreds.txt";
const searchTerm = process.argv[2] || "";

function loadCreds(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function exec(conn, sql, binds) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows))
    });
  });
}

const creds = loadCreds(CREDS_PATH);
const conn = snowflake.createConnection({
  account: creds.SNOWFLAKE_ACCOUNT,
  username: creds.SNOWFLAKE_USERNAME,
  password: creds.SNOWFLAKE_PASSWORD,
  warehouse: creds.SNOWFLAKE_WAREHOUSE,
  ...(creds.SNOWFLAKE_ROLE ? { role: creds.SNOWFLAKE_ROLE } : {})
});

try {
  await new Promise((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
  await exec(conn, "USE SECONDARY ROLES ALL");
  console.log("✓ Connected to Snowflake\n");

  // 1. Count total vs active
  const total = await exec(
    conn,
    "SELECT COUNT(*) AS cnt FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG"
  );
  const active = await exec(
    conn,
    `SELECT COUNT(*) AS cnt FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
     WHERE event_date_end >= CURRENT_DATE`
  );
  console.log(`Total campaigns in view: ${total[0].CNT}`);
  console.log(`Active campaigns (event_date_end >= today): ${active[0].CNT}`);
  console.log(`Expired campaigns: ${total[0].CNT - active[0].CNT}\n`);

  // 2. Show campaigns near today (ended within last 7 days or still active)
  const nearToday = await exec(
    conn,
    `SELECT team_name, event_name, event_date_start, event_date_end
     FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
     WHERE event_date_end >= DATEADD(day, -7, CURRENT_DATE)
     ORDER BY event_date_end DESC
     LIMIT 20`
  );
  console.log(`Campaigns ending within last 7 days or still active (${nearToday.length} rows):`);
  for (const row of nearToday) {
    const start = row.EVENT_DATE_START instanceof Date
      ? row.EVENT_DATE_START.toISOString().slice(0, 10)
      : String(row.EVENT_DATE_START);
    const end = row.EVENT_DATE_END instanceof Date
      ? row.EVENT_DATE_END.toISOString().slice(0, 10)
      : String(row.EVENT_DATE_END);
    const isActive = new Date(row.EVENT_DATE_END) >= new Date(new Date().toISOString().slice(0, 10));
    console.log(
      `  ${isActive ? "✅" : "❌"} ${row.TEAM_NAME} @ ${row.EVENT_NAME} (${start} → ${end})`
    );
  }

  // 3. Search by name if provided
  if (searchTerm) {
    console.log(`\nSearching for campaigns matching "${searchTerm}":`);
    const matches = await exec(
      conn,
      `SELECT team_name, event_name, event_date_start, event_date_end
       FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
       WHERE LOWER(event_name) LIKE LOWER(?) OR LOWER(team_name) LIKE(?)
       ORDER BY event_date_end DESC
       LIMIT 10`,
      [`%${searchTerm}%`, `%${searchTerm}%`]
    );
    if (matches.length === 0) {
      console.log("  No matches found in V_VDX_CAMPAIGN_CONFIG.");
    } else {
      for (const row of matches) {
        const start = row.EVENT_DATE_START instanceof Date
          ? row.EVENT_DATE_START.toISOString().slice(0, 10)
          : String(row.EVENT_DATE_START);
        const end = row.EVENT_DATE_END instanceof Date
          ? row.EVENT_DATE_END.toISOString().slice(0, 10)
          : String(row.EVENT_DATE_END);
        const isActive = new Date(row.EVENT_DATE_END) >= new Date(new Date().toISOString().slice(0, 10));
        console.log(
          `  ${isActive ? "✅ ACTIVE" : "❌ EXPIRED"} ${row.TEAM_NAME} @ ${row.EVENT_NAME} (${start} → ${end})`
        );
      }
    }
  }

  // 4. Show what today's date resolves to (the filter the app uses)
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nApp filter: event_date_end >= '${today}'`);
  console.log("(The /campaigns page uses this exact filter live against Snowflake)");

} catch (err) {
  console.error("\nERROR:", err?.message ?? err);
  process.exit(2);
} finally {
  conn.destroy(() => {});
}
