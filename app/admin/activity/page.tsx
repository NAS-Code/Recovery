import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminAuthenticated } from "@/lib/auth/admin-auth";
import { VdxHeader } from "@/app/_components/VdxHeader";
import { AutoRefresh } from "@/app/_components/AutoRefresh";
import { LogoutButton } from "../_components/LogoutButton";
import { ActivityFeed } from "./_components/ActivityFeed";
import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ActivityRow {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: string;
  classification: any;
  messageType: string | null;
  leadId: string;
  leadName: string;
  leadCompany: string | null;
  leadStatus: string;
  eventName: string;
  eventId: string;
  teamName: string;
}

function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set");
  if (!(globalThis as any).__activityPool) {
    (globalThis as any).__activityPool = new pg.Pool({
      connectionString,
      max: 3
    });
  }
  return (globalThis as any).__activityPool;
}

async function getActivityMessages(): Promise<ActivityRow[]> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.direction,
      c.text,
      c.timestamp,
      c.claude_classification AS classification,
      c.message_type AS "messageType",
      l.id AS "leadId",
      l.name AS "leadName",
      l.company AS "leadCompany",
      l.status AS "leadStatus",
      e.name AS "eventName",
      e.id AS "eventId",
      cl.name AS "teamName"
    FROM conversations c
    JOIN leads l ON l.id = c.lead_id
    JOIN events e ON e.id = l.event_id
    JOIN clients cl ON cl.id = l.client_id
    ORDER BY c.timestamp DESC
    LIMIT 500
  `);

  return rows;
}

async function getEventFilters(): Promise<Array<{ id: string; name: string; teamName: string }>> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT DISTINCT e.id, e.name, cl.name AS "teamName"
    FROM events e
    JOIN clients cl ON cl.id = e.client_id
    JOIN leads l ON l.event_id = e.id
    JOIN conversations c ON c.lead_id = l.id
    ORDER BY e.name
  `);

  return rows;
}

export default async function ActivityPage() {
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    redirect("/admin/login?next=/admin/activity");
  }

  const [messages, events] = await Promise.all([
    getActivityMessages(),
    getEventFilters()
  ]);

  // Serialize dates for the client component
  const serialized = messages.map((m) => ({
    ...m,
    timestamp: new Date(m.timestamp).toISOString(),
    messageType: m.messageType ?? null
  }));

  const eventOptions = events.map((e) => ({
    id: e.id,
    label: `${e.teamName} — ${e.name}`
  }));

  return (
    <>
      <VdxHeader rightSlot={<LogoutButton />} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <AutoRefresh intervalMs={10000} />
        <Link
          href="/admin/campaigns"
          className="text-xs text-vdx-plum/60 hover:text-vdx-coral hover:underline"
        >
          &larr; All campaigns
        </Link>

        <header className="mt-3 mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            SMS Activity
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            All messages across campaigns &middot; {messages.length} messages
          </p>
        </header>

        <ActivityFeed messages={serialized} events={eventOptions} />
      </main>
    </>
  );
}
