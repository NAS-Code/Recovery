import snowflake from "snowflake-sdk";
import { logger } from "@/lib/util/logger";

const QUERY_TIMEOUT_MS = 90_000; // 90s to allow for Snowflake warehouse wake-up

export class SnowflakeError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SnowflakeError";
  }
}

let cachedConnection: snowflake.Connection | null = null;

async function createAndConnect(): Promise<snowflake.Connection> {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USERNAME;
  const password = process.env.SNOWFLAKE_PASSWORD;
  if (!account || !username || !password) {
    throw new SnowflakeError(
      "SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME / SNOWFLAKE_PASSWORD must be set"
    );
  }

  const conn = snowflake.createConnection({
    account,
    username,
    password,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    ...(process.env.SNOWFLAKE_ROLE ? { role: process.env.SNOWFLAKE_ROLE } : {})
  });

  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });

  // Vendelux's pattern places warehouse USAGE in a secondary role
  // (ALL_WAREHOUSES_USAGE). Activate every granted role so the connection
  // can actually run compute regardless of which primary role we authed as.
  await execStatement(conn, "USE SECONDARY ROLES ALL");

  return conn;
}

async function getConnection(): Promise<snowflake.Connection> {
  if (cachedConnection && cachedConnection.isUp()) {
    return cachedConnection;
  }
  cachedConnection = await createAndConnect();
  return cachedConnection;
}

function execStatement<T>(
  conn: snowflake.Connection,
  sqlText: string,
  binds?: snowflake.Binds
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SnowflakeError(`Query timed out after ${QUERY_TIMEOUT_MS}ms`));
    }, QUERY_TIMEOUT_MS);

    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve((rows ?? []) as T[]);
      }
    });
  });
}

/**
 * Execute a parameterized query against the warm Snowflake connection.
 * Reconnects automatically if the cached connection has died.
 */
export async function query<T = Record<string, unknown>>(
  sqlText: string,
  binds?: snowflake.Binds
): Promise<T[]> {
  const startedAt = Date.now();
  const sqlPrefix = sqlText.replace(/\s+/g, " ").slice(0, 80);

  try {
    const conn = await getConnection();
    const rows = await execStatement<T>(conn, sqlText, binds);
    logger.info("snowflake.query.ok", {
      sqlPrefix,
      rowCount: rows.length,
      latencyMs: Date.now() - startedAt
    });
    return rows;
  } catch (err) {
    // Drop the cached connection on failure so the next call re-handshakes.
    cachedConnection = null;
    logger.error("snowflake.query.failed", {
      sqlPrefix,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    });
    throw new SnowflakeError(
      `Snowflake query failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}
