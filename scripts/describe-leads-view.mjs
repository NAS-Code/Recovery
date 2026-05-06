// Discover columns of SLOANE_LEADS_WITH_POSITIVE_STATUS, looking for OCM fields.
// Run from WSL:
//   cd /root/vdx && node /mnt/c/Users/n1sar/VDX/scripts/describe-leads-view.mjs

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

  console.log("=== SLOANE_LEADS_WITH_POSITIVE_STATUS columns ===");
  const cols = await exec(conn, "DESCRIBE VIEW DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS");
  for (const col of cols) {
    const mark = col.name.toLowerCase().includes("onsite") ||
                 col.name.toLowerCase().includes("ocm") ||
                 col.name.toLowerCase().includes("contact")
      ? " <<<" : "";
    console.log(`  ${col.name}  ${col.type}${mark}`);
  }

  // Sample a row with non-null onsite/contact/ocm fields
  console.log("\n=== Sample row (first with Meeting Booked) ===");
  const sample = await exec(conn, `SELECT * FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS WHERE STATUS = 'Meeting Booked' LIMIT 1`);
  if (sample.length > 0) {
    const row = sample[0];
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && v !== undefined && v !== "") {
        console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
  }
} catch (err) {
  console.error("ERROR:", err?.message ?? err);
  process.exit(2);
} finally {
  conn.destroy(() => {});
}
