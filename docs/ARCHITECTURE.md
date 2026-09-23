# Architecture

How the no-show recovery service is put together, and the parts that aren't
obvious from reading the code. Setup, env vars and the API surface are in the
[README](../README.md).

## 1. What this is

An automated service that recovers **no-show meetings** booked at events for
an events platform's concierge clients. When a lead misses a booked meeting,
the system reaches out over **SMS + email**, holds an AI-driven SMS
conversation to rebook (at the event or virtually), lets **callers** rebook by
phone, and keeps a client dashboard in sync. Humans (FDEs, forward-deployed
reps) are pulled in via Slack only when the AI can't safely handle a reply.

## 2. Stack

- Next.js 14 (App Router) + TypeScript; Tailwind for UI
- Prisma 6 + PostgreSQL via the `pg` driver adapter
- Snowflake (`snowflake-sdk`) — read-only source of lead/campaign data
- Anthropic Claude — inbound-SMS intent classifier
- ClickSend (SMS), Slack Web API (escalation + alerts), Instantly (email)
- Vercel hosting + cron; Vitest (93 unit tests)

## 3. Data model — who owns what

- **Snowflake = source of truth (read-only).** Leads, campaigns, sub-campaign
  config, meeting times, agent personas, native-scheduler slugs, Instantly
  workspace ids. The service never writes to Snowflake.
- **Postgres = concierge state.** The lead **status machine**, full SMS
  conversation history, admin/campaign sessions, campaign credentials, and a
  cached copy of each lead once it's marked no-show (`cacheSnowflakeLead`).
  Postgres `Lead.clientId` = Snowflake `TEAM_ID`; `Lead.eventId` = Snowflake
  `EVENT_ID`; `Lead.sourceLeadId` = Snowflake `LEAD_ID`.

Dashboards list leads from Snowflake and overlay concierge state from Postgres
at render time, so the warehouse stays the single source for who exists and
Postgres only holds what this service created.

**Lead status machine** (`lib/core/types.ts`, transitions in
`lib/core/conversation-state.ts`):
`scheduled → no_show → in_reschedule_convo | in_virtual_convo | context_question | uncategorized → confirmed_reschedule | confirmed_virtual | not_interested`.
Plus `pending_client_approval` (reschedule awaiting the client's OK) and
`canceled` (duplicate-phone suppression, auto-expired). Terminal states are
sticky. `ACTIVE_NO_SHOW_STATUSES` is the "still in the recovery flow" set.

## 4. Core flows

### a. Mark no-show (the entry point)
`POST /api/campaigns/[teamId]/[eventId]/leads/[sourceLeadId]/noshow` (admin or
campaign session). Pulls the lead from Snowflake, caches it to Postgres, then:
- **Duplicate-phone guard:** if another active lead shares the phone (or a
  cross-team match in the `POSITIVE_LEAD_DETAILS` view), the mark *silently
  succeeds* (dashboard shows no-show) but no SMS is sent; the lead is flagged
  `suppressedAt` and a cron cancels it after 1h. Clients never learn of the
  overlap.
- Otherwise: send the first recovery **SMS** (ClickSend), and — if the campaign
  has a **native scheduler link** and a resolvable sender — a one-off **email**
  (Instantly). Email failures never block the SMS or the response.
- (Legacy internal variant: `POST /api/leads/[id]/noshow`, client-cookie auth.)

### b. Inbound SMS → classify → reply or escalate
`POST /api/webhooks/clicksend`. Filters by destination number
(`CONCIERGE_INBOUND_NUMBERS`) so shared ClickSend numbers don't cross
workflows, then only acts on senders who are an active no-show lead. Claude
classifies the reply; the state machine decides the next status; the drafted
reply is sent, or the thread is escalated to Slack. **Reschedule
confirmations** don't auto-confirm: they run a 30-minute booth-level conflict
check (`lib/core/availability.ts`) against known meetings, then move to
`pending_client_approval` and surface a **Works / Doesn't work** prompt on the
client dashboard.

### c. Native scheduler rebooking links
`getSchedulerRebookLink` builds
`$SCHEDULER_BASE_URL<slug>?utm_source=concierge&utm_content=<sourceLeadId>`
from the app-DB tables replicated into Snowflake. SMS/email only ever carry
**native** links. The **booking-sync cron** (`scheduler-bookings`) polls
`MEETING_BOOKINGS`, matches a booking to a lead (by `utm_content`, else
attendee email), sets the meeting time, flips to `confirmed_reschedule`, and
fires the Slack alert — closing the loop without a webhook from the booking
app.

### d. Manual rebook (phone callers)
On the **Event View** and **Caller View**, the **Mark rebooked** button records
a caller's rebooking: *native* → confirm immediately; *external calendar* →
route through the same `pending_client_approval` flow.

### e. Crons (`vercel.json`, auth via `CRON_SECRET`)
| Path | Schedule (UTC) | Does |
|---|---|---|
| `/api/cron/eod-checkin` | `0 23 * * *` | Nudge active no-shows during the event |
| `/api/cron/end-of-event-virtual` | `0 14 * * *` | Offer a virtual meeting after the event ends |
| `/api/cron/cancel-suppressed` | `*/15 * * * *` | Suppressed (dup-phone) leads → `canceled` after 1h |
| `/api/cron/scheduler-bookings` | `*/15 * * * *` | Confirm native-scheduler rebookings from Snowflake |

## 5. URL / auth surface

- `/admin/*` — platform staff, `admin_session` cookie. Key pages: `campaigns`
  (home), `activity` (SMS feed), `events` + `events/[eventId]` (per event, all
  clients), `callers` (every lead in `no_show`, all clients). Cross-client data
  lives strictly under `/admin`.
- `/customer/[teamId]/[eventId]` — client dashboards; `campaign_session`
  (scoped to one campaign) or `admin_session`.
- `/dashboard/*` — earlier internal prototype (client cookie). `/campaigns/*`
  301s to the new paths.
- Auth lives in `lib/auth/{admin-auth,campaign-auth,context}.ts`. It is
  credential-based; `lib/auth/context.ts` is the single swap point for an SSO
  provider.

## 6. Integrations — the non-obvious bits

- **Instantly email:** v2 has no transactional send, so the service uses
  `POST /emails/test` (a real one-off send, no campaign). Auth is one
  **agency key** plus an **`x-as-workspace` header** set to the client's
  Instantly workspace id (from `V_TEAM_DETAILS`), so one key covers every
  client. The sender comes from the sub-campaign's
  `AGENT_PERSONAS[].agent_emails` (or `SENDER_EMAIL_LIST`).
- **Slack:** OCM/CSM reps are @-mentioned by resolving their names against the
  live Slack directory (`users.list`, needs `users:read`). Rebooking alerts go
  to `SLACK_REBOOKED_CHANNEL` (falls back to `SLACK_DEFAULT_CHANNEL`);
  escalations go to the lead's FDE or `SLACK_DEFAULT_CHANNEL`.
- **Sidecar leads table:** one client's leads were missing from the main leads
  view, so lookups for the team in `SIDECAR_LEADS_TEAM_ID` read
  `SIDECAR_LEADS_TABLE` instead, with columns aliased to the shared mapper. If
  that table is unreadable the campaign renders empty rather than erroring
  (logs `sidecar.leads_unavailable`). Unset, the special case is off.

## 7. Snowflake objects used

Names below are the generic ones used in this repo; point them at your own
views.

- `ANALYTICS.CONCIERGE.V_CAMPAIGN_CONFIG` — active campaigns
- `ANALYTICS.CONCIERGE.LEADS_WITH_POSITIVE_STATUS` — leads (status `Meeting Booked`)
- `ANALYTICS.CONCIERGE.V_SUB_CAMPAIGN_CONFIG` — persona, sender, `BOOKING_LINK`
- `ANALYTICS.CONCIERGE.V_TEAM_DETAILS` — `INSTANTLY_WORKSPACE_ID`
- `ANALYTICS.CONCIERGE.POSITIVE_LEAD_DETAILS` — cross-team phone dedup
- `APPDB.SCHEDULER.*` (replicated app DB) — `MEETING_HOST_EVENT_TYPES`,
  `EVENTS_MEETINGSUBCAMPAIGN`, `MEETING_BOOKINGS`

The connection runs `USE SECONDARY ROLES ALL` so warehouse usage granted via a
secondary role works. **These are live BI views with no schema contract** — a
column rename upstream has broken production before.
`scripts/describe-snowflake-view.mjs` is the quick check.

## 8. Design decisions worth knowing

- **Deterministic state machine around a probabilistic classifier.** Claude
  only returns a category, a confirmation flag and a draft; the transition
  logic is plain, fully unit-tested TypeScript. Terminal states are sticky, so
  a model mistake can't reopen a closed thread.
- **Fail-soft integrations.** Every external call has a timeout and structured
  logging. Missing config (Slack, email, cross-team dedup grant) logs and
  skips rather than failing the user-facing request; the dedup check fails
  *open* so a missing grant never blocks recovery.
- **Webhooks ack fast.** The ClickSend handler validates, returns 200, and does
  the Claude call and reply in `waitUntil`.
- **`lib/core` is framework- and DB-free**, so the business rules can move to
  another runtime unchanged.

## 9. Known gaps

- **SSO** is not integrated (credential auth today).
- **Webhook authentication.** ClickSend doesn't sign requests; add a shared
  secret to both webhook routes.
- **Inbound idempotency.** Retried ClickSend deliveries can be classified
  twice; store and unique-index the provider message id.
- **Email replies don't route** into the classifier (SMS only). The
  booking-sync cron covers native rebookings.
- **Free-text `BOOKING_LINK`** (Event/Caller View "Booking Link" button) is
  human-entered and sometimes isn't a booking URL.
- **Campaign credentials store a plaintext copy** (`password_plain`) next to
  the bcrypt hash so admins can re-share logins. A reset-link flow would let
  that column go.

## 10. Where things live

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
