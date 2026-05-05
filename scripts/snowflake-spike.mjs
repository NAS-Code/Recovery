// Smoke test for the Snowflake connection. Reads creds from
// /mnt/c/Users/n1sar/vdxCreds/snowflakeCreds.txt and runs a few read-only
// queries against the views the V1 dashboard will consume.
//
// NEVER echoes credentials — only counts and a 3-row sample of campaigns.
//
// Run from WSL:
//   bash /mnt/c/Users/n1sar/VDX/scripts/wsl-snowflake-spike.sh

import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";

const CREDS_PATH = "/mnt/c/Users/n1sar/vdxCreds/snowflakeCreds.txt";

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

function exec(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows))
    });
  });
}

const creds = loadCreds(CREDS_PATH);
for (const required of [
  "SNOWFLAKE_ACCOUNT",
  "SNOWFLAKE_USERNAME",
  "SNOWFLAKE_PASSWORD"
]) {
  if (!creds[required]) {
    console.error(`MISSING ${required} in ${CREDS_PATH}`);
    process.exit(1);
  }
}

const conn = snowflake.createConnection({
  account: creds.SNOWFLAKE_ACCOUNT,
  username: creds.SNOWFLAKE_USERNAME,
  password: creds.SNOWFLAKE_PASSWORD,
  warehouse: creds.SNOWFLAKE_WAREHOUSE,
  ...(creds.SNOWFLAKE_ROLE ? { role: creds.SNOWFLAKE_ROLE } : {})
});

const start = Date.now();
try {
  await new Promise((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
  console.log(`connected in ${Date.now() - start}ms`);

  // Activate every role this user has, so any role's warehouse USAGE counts.
  // Vendelux's pattern (ALL_WAREHOUSES_USAGE et al) relies on this.
  await exec(conn, "USE SECONDARY ROLES ALL");

  const ctx = await exec(
    conn,
    "SELECT CURRENT_USER() AS user, CURRENT_ROLE() AS role, CURRENT_WAREHOUSE() AS warehouse"
  );
  console.log("session:", ctx[0]);

  const total = await exec(
    conn,
    "SELECT COUNT(*) AS total FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG"
  );
  console.log("campaigns total:", total[0].TOTAL);

  const active = await exec(
    conn,
    `SELECT COUNT(*) AS active
     FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
     WHERE event_date_end >= CURRENT_DATE`
  );
  console.log("active campaigns:", active[0].ACTIVE);

  const sample = await exec(
    conn,
    `SELECT vdx_campaign_id, team_name, event_name, event_date_start, event_date_end
     FROM SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG
     WHERE event_date_end >= CURRENT_DATE
     ORDER BY event_date_start
     LIMIT 3`
  );
  console.log("sample:");
  for (const row of sample) {
    console.log(
      `  ${row.TEAM_NAME} @ ${row.EVENT_NAME} (${row.EVENT_DATE_START.toISOString().slice(0, 10)} → ${row.EVENT_DATE_END.toISOString().slice(0, 10)})`
    );
  }

  const leads = await exec(
    conn,
    `SELECT COUNT(*) AS total
     FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS`
  );
  console.log("positive-status leads (across all campaigns):", leads[0].TOTAL);

  console.log("\nALL OK");
} catch (err) {
  console.error("\nERROR:", err?.message ?? err);
  if (err?.code) console.error("code:", err.code);
  process.exit(2);
} finally {
  conn.destroy(() => {});
}
