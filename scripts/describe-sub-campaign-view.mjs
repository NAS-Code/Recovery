// Discover the schema of V_VDX_SUB_CAMPAIGN_CONFIG and sample a few rows.
//
// Run from WSL:
//   node /mnt/c/Users/n1sar/VDX/scripts/describe-sub-campaign-view.mjs

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
  console.log("Connected\n");

  // 1. Describe the view
  console.log("=== COLUMNS ===");
  const cols = await exec(conn, "DESCRIBE VIEW SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG");
  for (const col of cols) {
    console.log(`  ${col.name}  ${col.type}`);
  }

  // 2. Row count
  const count = await exec(conn, "SELECT COUNT(*) AS cnt FROM SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG");
  console.log(`\nTotal rows: ${count[0].CNT}`);

  // 3. Sample 5 rows
  console.log("\n=== SAMPLE (5 rows) ===");
  const sample = await exec(conn, "SELECT * FROM SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG LIMIT 5");
  for (const row of sample) {
    console.log(JSON.stringify(row, null, 2));
    console.log("---");
  }

  // 4. Check how it joins to campaigns — look for common keys
  console.log("\n=== CAMPAIGN CONFIG COLUMNS (for join reference) ===");
  const campaignCols = await exec(conn, "DESCRIBE VIEW SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG");
  for (const col of campaignCols) {
    console.log(`  ${col.name}  ${col.type}`);
  }

} catch (err) {
  console.error("ERROR:", err?.message ?? err);
  process.exit(2);
} finally {
  conn.destroy(() => {});
}
