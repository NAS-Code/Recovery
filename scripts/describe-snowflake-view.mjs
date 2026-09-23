/**
 * Print the columns of a Snowflake view (and optionally a sample row), for
 * checking upstream schema changes against the queries in lib/integrations.
 *
 * Usage:
 *   node scripts/describe-snowflake-view.mjs <DB.SCHEMA.VIEW> [--sample]
 *
 * Reads SNOWFLAKE_ACCOUNT / _USERNAME / _PASSWORD / _WAREHOUSE / _ROLE from
 * the environment. Never prints credentials.
 */
import snowflake from "snowflake-sdk";

const [view, flag] = process.argv.slice(2);
if (!view || !/^[A-Za-z0-9_$.]+$/.test(view)) {
  console.error("Usage: node scripts/describe-snowflake-view.mjs <DB.SCHEMA.VIEW> [--sample]");
  process.exit(1);
}

const required = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USERNAME", "SNOWFLAKE_PASSWORD", "SNOWFLAKE_WAREHOUSE"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

function exec(conn, sqlText) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows))
    });
  });
}

const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  ...(process.env.SNOWFLAKE_ROLE ? { role: process.env.SNOWFLAKE_ROLE } : {})
});

try {
  await new Promise((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
  await exec(conn, "USE SECONDARY ROLES ALL");

  console.log(`=== ${view} columns ===`);
  for (const col of await exec(conn, `DESCRIBE VIEW ${view}`)) {
    console.log(`  ${col.name}  ${col.type}`);
  }

  if (flag === "--sample") {
    console.log("\n=== sample row (non-null fields) ===");
    const [row] = await exec(conn, `SELECT * FROM ${view} LIMIT 1`);
    for (const [k, v] of Object.entries(row ?? {})) {
      if (v !== null && v !== undefined && v !== "") {
        console.log(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
  }
} catch (err) {
  console.error("ERROR:", err?.message ?? err);
  process.exitCode = 2;
} finally {
  conn.destroy(() => {});
}
