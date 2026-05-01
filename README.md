# No-Show Recovery

Standalone prototype of an event concierge no-show recovery service. Designed
to be lifted into Vendelux + Snowflake later — see [Swapping Postgres for
Snowflake](#swapping-postgres-for-snowflake).

> **Vendelux integration plan:** [docs/vendelux-integration.md](docs/vendelux-integration.md).
> Agent conventions: [AGENTS.md](AGENTS.md).

## What it does

Clients run booths at industry events and pre-schedule meetings with leads. When
a lead misses a meeting, the client (or the FDE on their behalf) marks them
no-show in the dashboard. The system then:

1. Sends a recovery SMS via Clicksend, including the native scheduling link if
   configured.
2. Receives the lead's reply via the Clicksend inbound webhook.
3. Calls the Claude API to classify the conversation and draft a reply.
4. Applies a deterministic state machine to decide what status the lead should
   be in.
5. Either sends the drafted SMS back via Clicksend, or hands the thread off to
   the FDE in Slack with full conversation context.
6. Runs cron jobs at end-of-day (nudge stalled leads) and end-of-event (offer a
   virtual meeting after the event closes).

The no-show mark only clears when a reschedule or virtual meeting is *confirmed*
in the conversation, not on the first positive reply — multiple back-and-forth
messages are normal before that point.

## Stack

- Next.js 14 (App Router) + TypeScript
- Prisma 6 + PostgreSQL via the `pg` driver adapter
- Tailwind for the dashboard
- Anthropic SDK with structured tool-use + prompt caching
- Clicksend for SMS, Slack Web API for FDE handoff, Instantly for email
- Vercel Cron for scheduled jobs
- Vitest for unit tests

## Setup

### Local development

```bash
cp .env.example .env       # then fill in values
npm install
npm run db:migrate -- --name init
npm run db:seed
npm run dev                # http://localhost:3000
```

### Windows ARM64 (Snapdragon-class) developers

Prisma does not ship a Windows ARM64 query-engine binary. Run inside WSL2 instead:

```powershell
winget install --id Microsoft.WSL
wsl --install -d Ubuntu
```

Then in the Ubuntu shell, install Node 22 + Postgres, copy the project to
`~/vdx`, and run the steps above. There's a re-runnable smoke check at
[scripts/wsl-smoke-native.sh](scripts/wsl-smoke-native.sh) that does the full
install + tests + typecheck flow.

### Run the test suite

```bash
npm test           # 51 unit tests across the state machine, parsers, templates
npm run typecheck  # strict TS
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | Claude API for classification + drafting |
| `CLAUDE_MODEL` | no | Override; defaults to `claude-sonnet-4-6` |
| `CLICKSEND_USERNAME` | yes (for SMS) | Clicksend basic-auth username |
| `CLICKSEND_API_KEY` | yes (for SMS) | Clicksend API key |
| `CLICKSEND_FROM_NUMBER` | yes (for SMS) | Sender number |
| `SLACK_BOT_TOKEN` | yes (for FDE handoff) | `xoxb-…` token, scopes: `chat:write` |
| `SLACK_DEFAULT_CHANNEL` | no | Fallback channel when a lead has no `fde_owner_slack_id` |
| `INSTANTLY_API_KEY` | no | Required only when emailing |
| `APP_BASE_URL` | no | Public URL (used for "Open in dashboard" buttons in Slack) |
| `CRON_SECRET` | yes (in production) | Vercel Cron `Authorization: Bearer …` shared secret |

Missing config fails *closed* — the Slack notifier logs a warning and skips
rather than throwing into the webhook async work, and cron routes return 401
when `CRON_SECRET` is unset.

## Multi-tenant client dashboard

The dashboard is **client-facing**: each client signs in and only sees their
own events and leads. The auth surface is:

| Path | Access |
| --- | --- |
| `/sign-in` | public — dev placeholder that lists clients and sets a cookie on selection |
| `/dashboard/**` | authenticated client (gated by [middleware.ts](middleware.ts)) |
| `POST /api/leads/:id/noshow` | authenticated; verifies `lead.clientId === session.clientId` (403 otherwise) |
| `POST /api/auth/sign-in` / `/sign-out` | public (cookie write) |

The auth implementation is intentionally a thin abstraction:
[lib/auth/context.ts](lib/auth/context.ts) reads a `client_id` cookie and
returns `{ clientId }`. To replace it with NextAuth, Clerk, or whatever
Vendelux uses, **swap that one file** — every consumer downstream depends only
on the `ClientContext` shape.

The cookie is `httpOnly`, `sameSite: lax`, and `secure` in production. The
sign-in screen at `/sign-in` is dev-only — it lists every client in the
database for easy switching during testing. Replace it before shipping.

### What's wired into multi-tenancy

- Dashboard reads scoped to `ctx.clientId` via `getCurrentEventForClient()`
- Thread view returns 404 (rather than 403) on cross-client lead access — hides existence
- Noshow endpoint enforces ownership before any DB or SMS work
- Middleware redirects unauth requests on `/dashboard/**` to `/sign-in?next=...`
- [scripts/auth-flow-test.ps1](scripts/auth-flow-test.ps1) — re-runnable end-to-end check covering all 8 paths

### What's NOT yet wired

- **No FDE/admin role.** Add a `role` field on the session (or a separate
  internal-staff table) and a `role === "admin"` check before unscoped queries.
  An admin view at `/admin/dashboard` would surface every client's leads.
- **Cron jobs are still single-tenant per run.** `runEodCheckin` calls
  `getCurrentEvent()` (returns one event globally). Multi-client cron needs
  iteration over all currently-running events — straightforward extension once
  you decide whether to fan out per client or run one job per client schedule.
- **No real auth provider.** The dev sign-in is functional but trivially
  forgeable (the cookie is just the client id, no signature). NextAuth with
  email magic links is the cheapest production-grade swap.
- **No client-onboarding flow.** New clients are seeded directly in the DB.
  Adding a `/api/admin/clients` endpoint or wiring to Vendelux's existing
  client provisioning is out of scope for this prototype.
- **No client-side branding.** All dashboards look identical. If clients
  expect their own logo/colors, add a `Client.brandingJson` column and a
  layout that consumes it.

## Architecture

```
app/
├── api/
│   ├── auth/
│   │   ├── sign-in/route.ts             # cookie set (dev placeholder for real auth)
│   │   └── sign-out/route.ts            # cookie clear
│   ├── leads/[id]/noshow/route.ts       # 1st outbound + status flip; ownership-gated
│   ├── webhooks/
│   │   ├── clicksend/route.ts           # inbound SMS → classify → reply or escalate
│   │   └── scheduling/route.ts          # self-rescheduled leads
│   └── cron/
│       ├── eod-checkin/route.ts
│       └── end-of-event-virtual/route.ts
├── dashboard/                           # client-facing, middleware-gated
│   ├── page.tsx                         # event list view (scoped to session.clientId)
│   └── [leadId]/page.tsx                # thread view (404 on cross-client access)
├── sign-in/page.tsx                     # dev sign-in placeholder
└── ...

middleware.ts                            # gates /dashboard/** on client cookie

lib/auth/
└── context.ts                           # cookie-backed ClientContext (swap-in point for real auth)

lib/
├── core/                                # framework- and DB-free logic
│   ├── conversation-state.ts            # pure (status, classification) → status
│   ├── classifier-prompts.ts            # version-controlled Claude prompt + tool schema
│   ├── outbound-templates.ts            # SMS copy
│   └── types.ts
├── integrations/
│   ├── data.ts                          # LeadRepository interface (the swap point)
│   ├── data.prisma.ts                   # Postgres impl
│   ├── prisma.ts                        # singleton client w/ pg driver adapter
│   ├── claude.ts                        # Anthropic SDK wrapper, parseClassification
│   ├── clicksend.ts                     # sendSms + parseInboundWebhook
│   ├── slack.ts                         # Block Kit FDE notification
│   └── instantly.ts                     # sendEmail
├── jobs/
│   ├── eod-checkin.ts                   # pure orchestration; tested via real DB
│   └── end-of-event-virtual.ts
└── util/
    ├── logger.ts                        # JSON-line structured logger
    ├── fetch-with-timeout.ts
    └── cron-auth.ts
```

### Lead status state machine

Statuses: `scheduled`, `no_show`, `in_reschedule_convo`, `confirmed_reschedule`,
`in_virtual_convo`, `confirmed_virtual`, `context_question`, `not_interested`,
`uncategorized`.

Rules implemented in [lib/core/conversation-state.ts](lib/core/conversation-state.ts):

- Terminal states (`confirmed_reschedule`, `confirmed_virtual`,
  `not_interested`) are sticky — re-opening a closed thread is an FDE decision,
  not Claude's.
- `scheduled` is pre-no-show; the state machine never transitions out of it.
- `is_confirmation` only matters for the two reschedule categories. For
  context_question, not_interested, and uncategorized it's ignored.
- Pivots between `in_reschedule_convo` and `in_virtual_convo` are allowed.
- Direct jumps from `no_show` → `confirmed_*` happen when the very first reply
  unambiguously accepts a specific time we proposed.

### Claude classifier

System prompt + tool schema are version-controlled constants at
[lib/core/classifier-prompts.ts](lib/core/classifier-prompts.ts). The system
prompt explicitly defines `is_confirmation` as: *"true ONLY when the lead's
latest message confirms a specific time or plan that was previously proposed in
this thread."*

Output schema (forced via `tool_choice`):

```ts
{
  category: "reschedule_at_event" | "virtual_meeting" | "context_question"
          | "not_interested" | "uncategorized",
  is_confirmation: boolean,
  reasoning: string,
  draft_reply: string | null
}
```

Prompt caching is on — the system prompt has `cache_control: "ephemeral"`, so
subsequent classifications within 5 minutes read it from cache. Token usage
including `cache_read_input_tokens` is logged per call.

### Webhook flow (Clicksend inbound)

1. Validate JSON + payload schema synchronously.
2. Respond `200` immediately via Vercel's `waitUntil`.
3. Async: look up the active no-show lead by phone; if none, drop the message.
4. Build a tentative thread (history + new inbound), classify with Claude.
5. Persist the inbound message with the classification attached (single insert).
6. Apply `nextState`; update lead status if it changed.
7. If `draft_reply` is non-null → send via Clicksend, append outbound row.
8. If `draft_reply` is null → notify FDE via Slack with full thread context.

### Cron jobs

| Path | Schedule (UTC) | Behavior |
| --- | --- | --- |
| `/api/cron/eod-checkin` | `0 23 * * *` | For the current event, send a follow-up to active no-shows whose last inbound is older than 4h. |
| `/api/cron/end-of-event-virtual` | `0 14 * * *` | For events that ended in the last 36h, offer a virtual meeting to active no-shows. Idempotent via a marker phrase in the conversation. |

Both schedules are placeholders — adjust to your business timezone in
[vercel.json](vercel.json). Vercel Hobby tier limits crons to once-per-day; both
schedules already comply.

## API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/leads/:id/noshow` | client cookie + ownership | Mark a `scheduled` lead as `no_show`, fire first outbound SMS |
| POST | `/api/webhooks/clicksend` | none (TODO: shared secret) | Inbound SMS, async classification + reply |
| POST | `/api/webhooks/scheduling` | none (TODO: shared secret) | Lead self-rescheduled via native link → `confirmed_reschedule` |
| GET | `/api/cron/eod-checkin` | `Bearer $CRON_SECRET` | Cron-only |
| GET | `/api/cron/end-of-event-virtual` | `Bearer $CRON_SECRET` | Cron-only |
| POST | `/api/auth/sign-in` | none | Set client cookie (dev placeholder) |
| POST | `/api/auth/sign-out` | client cookie | Clear client cookie |

## What's intentionally NOT in scope yet

These are flagged in the conversation history; pick them up before production.

- **Real auth provider.** Dev sign-in cookie is forgeable. Swap
  [lib/auth/context.ts](lib/auth/context.ts) for NextAuth (or Clerk, or
  whatever Vendelux uses) with email magic links or SSO.
- **FDE/admin role + `/admin/**` views.** Today only client view exists.
- **Multi-event/multi-client cron.** `runEodCheckin` is single-event-per-run.
- **Webhook signature verification.** Clicksend doesn't sign, but you should
  add a query-param secret to `/api/webhooks/clicksend` and `/api/webhooks/scheduling`.
- **Idempotency on Clicksend inbound.** Retry deliveries can cause duplicate
  classification + reply. Lowest-cost fix: a unique index on a stored
  `provider_message_id`.
- **Synchronous scheduling webhook.** It writes to the DB inline so the
  scheduler provider sees real success/failure. If volume gets high, move it
  behind `waitUntil` like the Clicksend handler.
- **Slack interactivity.** The notification has an "Open in dashboard" URL
  button only. Adding "Take over thread" / "Mark resolved" interactive buttons
  needs a `/api/webhooks/slack/interactions` route + signing-secret verification.
- **Instantly email is implemented but not wired.** `sendEmail()` is callable
  from anywhere, but no caller invokes it yet — decide where (SMS fallback,
  long-form FDE reply, post-event nurture) and hook it in.
- **`virtualOfferSentAt` column.** Step 10 deduplicates the virtual offer by
  scanning conversation text for a marker phrase. Cheap but fragile to template
  edits — replace with a column or an `OutboundJobLog` table when convenient.

## Swapping Postgres for Snowflake

All data access goes through the `LeadRepository` interface in
[lib/integrations/data.ts](lib/integrations/data.ts). The Prisma/Postgres
implementation lives in
[lib/integrations/data.prisma.ts](lib/integrations/data.prisma.ts). The
interface methods are:

```ts
getLead(id)
getActiveLeadByPhone(phone)
getConversationHistory(leadId)
appendMessage({ leadId, direction, text, classification?, timestamp? })
updateLeadStatus(leadId, status)
updateScheduledMeetingTime(leadId, time)
getActiveNoShows(eventId?)
getFdeOwner(leadId)
getMidConversationLeads(now)
getCurrentEvent(now?)
getLeadsForEvent(eventId)
getRecentlyEndedEvents(now, lookbackHours)
```

To target Snowflake:

1. Add `lib/integrations/data.snowflake.ts` implementing the same interface
   against the Vendelux warehouse (likely via the Node Snowflake SDK or your
   existing Snowflake client).
2. Update the factory in `lib/integrations/data.ts` to return the Snowflake
   impl based on an env var (`DATA_BACKEND=snowflake`).
3. The `Conversation` table specifically may not exist in Snowflake; either
   model it there or back it with a different store (DynamoDB, Postgres) and
   compose two implementations behind one interface.

The state machine, prompts, Claude wrapper, route handlers, jobs, and dashboard
do not import Prisma directly and require no changes. The Prisma migrations and
seed remain local-development-only.

## Test coverage

51 unit tests across:

- [tests/conversation-state.test.ts](tests/conversation-state.test.ts) — every
  transition path including pivots, terminal stickiness, and `is_confirmation`
  edge cases.
- [tests/claude-parser.test.ts](tests/claude-parser.test.ts) — Zod schema for
  the tool output + the user-message formatter.
- [tests/clicksend-parser.test.ts](tests/clicksend-parser.test.ts) — webhook
  payload variants (timestamp formats, customstring vs custom_string, malformed
  inputs).
- [tests/outbound-templates.test.ts](tests/outbound-templates.test.ts) — SMS
  template formatting.

Integration of Claude, Clicksend, Slack, Instantly is not unit-tested — those
are exercised via the dev server + real credentials.
