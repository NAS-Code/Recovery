/**
 * Reset a lead back to status=scheduled with no conversation history, so the
 * no-show → SMS flow can be tested from the top.
 *
 * Usage:
 *   node scripts/reset-test-lead.mjs ["Lead Name"] [--phone +15555550100]
 *
 * Defaults to the seeded "Alice Johnson". --phone points the lead at a real
 * handset for an SMS round-trip. Uses DATABASE_URL (local Postgres by default).
 */
import pg from "pg";

const args = process.argv.slice(2);
const phoneIdx = args.indexOf("--phone");
const phone = phoneIdx >= 0 ? args[phoneIdx + 1] : null;
if (phoneIdx >= 0 && !phone) {
  console.error("--phone needs a value, e.g. --phone +15555550100");
  process.exit(1);
}
const leadName =
  args.filter((_, i) => i !== phoneIdx && i !== phoneIdx + 1)[0] ?? "Alice Johnson";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/noshow_recovery"
});

try {
  const {
    rows: [lead]
  } = await pool.query(`SELECT id FROM leads WHERE name = $1 LIMIT 1`, [leadName]);
  if (!lead) {
    console.error(`Lead not found: ${leadName}`);
    process.exitCode = 1;
  } else {
    const del = await pool.query(`DELETE FROM conversations WHERE lead_id = $1`, [lead.id]);
    const meetingTime = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE leads
          SET status = 'scheduled',
              scheduled_meeting_time = $1,
              phone = COALESCE($2, phone)
        WHERE id = $3`,
      [meetingTime.toISOString(), phone, lead.id]
    );
    console.log(
      JSON.stringify(
        {
          id: lead.id,
          name: leadName,
          status: "scheduled",
          scheduledMeetingTime: meetingTime.toISOString(),
          phoneUpdated: Boolean(phone),
          conversationsDeleted: del.rowCount
        },
        null,
        2
      )
    );
  }
} finally {
  await pool.end();
}
