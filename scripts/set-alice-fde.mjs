// Set Alice's fdeOwnerSlackId for testing
import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.vercel.production");
const envText = readFileSync(envPath, "utf8");
const dbLine = envText.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const connStr = dbLine.split("=").slice(1).join("=").replace(/^"|"$/g, "");

const pool = new pg.Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const res = await pool.query(
  `UPDATE leads SET fde_owner_slack_id = $1 WHERE name = 'Alice Johnson'`,
  ["U0AK6M6CJ7J"]
);
console.log("Updated", res.rowCount, "row(s) — fdeOwnerSlackId set to U0AK6M6CJ7J");
await pool.end();
