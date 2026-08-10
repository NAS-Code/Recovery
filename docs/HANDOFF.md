# Concierge No-Show Recovery — Engineering Handoff

Last updated: 2026-08-05

## 1. What this is

An automated service that recovers **no-show meetings** booked at events for
Vendelux's concierge clients. When a lead misses a booked meeting, the system
reaches out over **SMS + email**, holds an AI-driven SMS conversation to
rebook (at the event or virtually), lets **callers** rebook by phone, and keeps
a client dashboard in sync. Humans (FDEs) are pulled in via Slack only when the
AI can't safely handle a reply.

- **Production:** https://concierge.vendelux.com (Vercel, custom domain)
- **Repo:** `Vendelux/concierge-noshow-recovery`, default branch `main`
- **Deploys:** manual — `npx vercel --prod` from a clean `main`. Git auto-deploy is not relied on.

## 2. Stack

- Next.js 14 (App Router) + TypeScript; Tailwind for UI
- Prisma 6 + PostgreSQL (Neon in prod) via the `pg` driver adapter
- Snowflake (`snowflake-sdk`) — read-only source of Vendelux lead/campaign data
- Anthropic Claude — inbound-SMS intent classifier
- ClickSend (SMS), Slack Web API (escalation + alerts), Instantly (email)
- Vercel hosting + cron; Vitest (93 unit tests)

Windows ARM devs: Prisma has no Windows-ARM query engine — use WSL2 (see README).

## 3. Data model — who owns what

- **Snowflake = source of truth (read-only).** Leads, campaigns, sub-campaign
  config, meeting times, agent personas, native-scheduler slugs, Instantly
  workspace ids. Concierge never writes to Snowflake.
- **Postgres = concierge state.** The lead **status machine**, full SMS
  conversation history, admin/campaign sessions, campaign credentials, and a
  cached copy of each lead once it's marked no-show (`cacheSnowflakeLead`).
  Postgres `Lead.clientId` = Snowflake `TEAM_ID`; `Lead.eventId` = Snowflake `EVENT_ID`.

**Lead status machine** (`lib/core/types.ts`, transitions in `lib/core/conversation-state.ts`):
`scheduled → no_show → in_reschedule_convo | in_virtual_convo | context_question | uncategorized → confirmed_reschedule | confirmed_virtual | not_interested`.
Plus `pending_client_approval` (reschedule awaiting the client's OK) and
`canceled` (duplicate-phone suppression, auto-expired). Terminal states are
sticky. `ACTIVE_NO_SHOW_STATUSES` is the "still in the recovery flow" set.

## 4. Core flows

### a. Mark no-show (the entry point)
`POST /api/campaigns/[teamId]/[eventId]/leads/[vendeluxLeadId]/noshow` (admin or
campaign session). Pulls the lead from Snowflake, caches to Postgres, then:
- **Duplicate-phone guard:** if another active concierge lead shares the phone
  (or a cross-team match in `SILVER.TEXTING.POSITIVE_LEAD_DETAILS`), the mark
  *silently succeeds* (dashboard shows no-show) but no SMS is sent; the lead is
  flagged `suppressedAt` and a cron cancels it after 1h. Clients never learn of
  the overlap.
- Otherwise: send the first recovery **SMS** (ClickSend), and — if the campaign
  has a **native scheduler link** and a resolvable sender — a one-off **email**
  (Instantly). Email failures never block the SMS or the response.
- (Legacy internal variant: `POST /api/leads/[id]/noshow`, client-cookie auth.)

### b. Inbound SMS → classify → reply or escalate
`POST /api/webhooks/clicksend`. Filters by destination number
(`CONCIERGE_INBOUND_NUMBERS`) so shared ClickSend numbers don't cross workflows,
then only acts on senders who are an active no-show lead. Claude classifies the
reply; the state machine decides the next status; the drafted reply is sent, or
the thread is escalated to Slack. **Reschedule confirmations** don't auto-confirm:
they run a 30-min booth-level conflict check (`lib/core/availability.ts`) against
known meetings, then move to `pending_client_approval` and surface a
**Works / Doesn't work** popup on the client dashboard.

### c. Native scheduler rebooking links
`getSchedulerRebookLink` builds `https://vendelux.com/app/rsvp/hosted/<slug>?utm_source=concierge&utm_content=<vendeluxLeadId>`
from the app-DB Fivetran tables. The SMS/email only carry **native** links.
The **booking-sync cron** (`scheduler-bookings`) polls `MEETING_BOOKINGS`,
matches a booking to a lead (by `utm_content`, else attendee email), sets the
meeting time, flips to `confirmed_reschedule`, and fires the Slack alert —
closing the loop without a webhook from the events app.

### d. Manual rebook (phone callers)
On the **Event View** and **Caller View**, the **Mark rebooked** button records
a caller's rebooking: *native* → confirm immediately; *external calendar* →
route through the same `pending_client_approval` client-approval flow.

### e. Crons (`vercel.json`, auth via `CRON_SECRET`)
| Path | Schedule (UTC) | Does |
|---|---|---|
| `/api/cron/eod-checkin` | `0 23 * * *` | Nudge active no-shows during the event |
| `/api/cron/end-of-event-virtual` | `0 14 * * *` | Offer a virtual meeting after the event ends |
| `/api/cron/cancel-suppressed` | `*/15 * * * *` | Suppressed (dup-phone) leads → `canceled` after 1h |
| `/api/cron/scheduler-bookings` | `*/15 * * * *` | Confirm native-scheduler rebookings from Snowflake |

## 5. URL / auth surface

- `/admin/*` — Vendelux staff, `admin_session` cookie. Key pages: `campaigns`
  (home), `activity` (SMS feed), `events` + `events/[eventId]` (per-event, all
  clients), `callers` (every lead in `no_show`, all clients). Cross-client data
  lives strictly under `/admin`.
- `/customer/[teamId]/[eventId]` — client dashboards; `campaign_session` (scoped)
  or `admin_session`.
- `/dashboard/*` — earlier internal prototype (client-cookie). `/campaigns/*` 301s to the new paths.
- Auth impl: `lib/auth/{admin-auth,campaign-auth,context}.ts`. Credential-based
  today; **Auth0 is the intended replacement** (not yet done).

## 6. Integrations — the non-obvious bits

- **Instantly email:** v2 has no transactional send — we use `POST /emails/test`
  (real one-off, no campaign). Auth is the **parent/agency key**
  (`Instantly_API_Key_Full_Email_Create`) plus an **`x-as-workspace` header** set
  to the client's Instantly workspace id (from `V_TEAM_DETAILS`). One key covers
  every client. Sender (`eaccount`) comes from the sub-campaign's
  `AGENT_PERSONAS[].agent_emails` (or `SENDER_EMAIL_LIST`). Mirrors
  `Vendelux/data` `instantly_service_base.py`.
- **Slack:** OCM/CSM are @-mentioned by resolving their names against the live
  Slack directory (`users.list`, needs `users:read`). Rebooking alerts go to a
  channel (`SLACK_REBOOKED_CHANNEL`, defaults to a hardcoded id); escalations to
  `SLACK_DEFAULT_CHANNEL`.
- **AutoStore special case:** AutoStore (`TEAM_ID d3c63d41…`) is absent from the
  Sigma leads view, so its lead lookups read a dedicated table
  (`DATA_ANALYSIS_SANDBOXES.SANDBOX.DEB_NICK_HACKATHON_AUTOSTORE_DATA`) with
  columns aliased to the shared mapper. **This is a hackathon sandbox table**,
  not a durable source — see gaps.

## 7. Snowflake objects used

- `SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG` — active campaigns
- `DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS` — leads (status `Meeting Booked`)
- `SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG` — persona, sender, `BOOKING_LINK`
- `SILVER.SLOANE_V2.V_TEAM_DETAILS` — `INSTANTLY_WORKSPACE_ID`
- `VDXDB.APPDB_VEND2.*` (Fivetran app-DB copy) — `MEETING_HOST_EVENT_TYPES`,
  `EVENTS_MEETINGSUBCAMPAIGN`, `MEETING_BOOKINGS`, etc.
- Connection uses role `FDE` + `USE SECONDARY ROLES ALL`. **Schema drift here has
  broken prod before** (a column rename) — there's no contract; coordinate with Data.

## 8. Environment variables

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL?`, `CLICKSEND_USERNAME/API_KEY/FROM_NUMBER`,
`CONCIERGE_INBOUND_NUMBERS?`, `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL?`, `SLACK_REBOOKED_CHANNEL?`,
`Instantly_API_Key_Full_Email_Create` (agency send key), `APP_BASE_URL?`, `CRON_SECRET`,
`SNOWFLAKE_ACCOUNT/USERNAME/PASSWORD/WAREHOUSE?/ROLE?`, admin creds
(`CAMPAIGNS_ADMIN_USERNAME/PASSWORD`). Snowflake vars are marked *sensitive* in
Vercel, so `vercel env pull` returns them blank locally.
Note: `INSTANTLY_API_KEY` / `Instantly_API_Key_Autostore` are legacy/unused — safe to delete.

## 9. Deploy & local dev

- **Deploy:** `npx vercel --prod` on a clean `main`. `vercel-build` runs
  `prisma generate && prisma migrate deploy && next build`, so committed
  migrations auto-apply to prod. Plain `build` skips migrate (for CI, which has
  no DB). CI gate: `typecheck · test · build` + 1 review required on `main`.
- **Local:** `cp .env.example .env`, `npm i`, `npm run db:migrate`, `npm run dev`.
  `npm run typecheck` + `npm test` before pushing.
- **Test data:** `scripts/reset-alice.mjs` etc. point at **prod** via
  `.env.vercel.production` (`vercel env pull`). AutoStore/Ai4 2026 is the
  end-to-end test campaign (all leads share one test phone `+15105590605`).

## 10. Known gaps / open items

- **Auth0** not integrated (credential auth today).
- **`SILVER.TEXTING.POSITIVE_LEAD_DETAILS`** not readable by our role → cross-team
  dedup check **fails open** (logged `noshow.cross_team_check_unavailable`). Needs a SELECT grant.
- **AutoStore sandbox table** is a hackathon artifact; rebuilds drop our grant
  (page fails soft to empty, logs `autostore.leads_unavailable`). Needs a
  `FUTURE TABLES` grant or a durable table.
- **Email replies don't route** into the classifier (SMS-only). The scheduler
  booking-sync cron covers native rebookings; an Instantly reply webhook is deferred.
- **Deferred features:** Vendelux-provided-calendar mode, virtual-meeting overlap checks.
- **Free-text `BOOKING_LINK`** (Event/Caller View "Booking Link" button) is
  human-judged — reps sometimes paste non-booking URLs even on qualifying sub-campaigns.

## 11. Where things live (quick map)

```
app/api/campaigns/.../noshow/route.ts     mark no-show (main entry)
app/api/webhooks/clicksend/route.ts       inbound SMS → classify → reply/escalate
app/api/cron/*                            the 4 crons
app/api/admin/leads/[id]/manual-rebook/   caller rebook
app/admin/{campaigns,events,callers}/     admin views
lib/core/{conversation-state,classifier-prompts,outbound-templates,availability}.ts
lib/integrations/{data,data.prisma,snowflake,leads.snowflake,meetings,clicksend,claude,slack,instantly}.ts
lib/jobs/{eod-checkin,end-of-event-virtual,scheduler-bookings}.ts
prisma/schema.prisma                      Postgres schema + migrations
```
