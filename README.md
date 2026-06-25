# Vendelux Concierge — No-Show Recovery

AI-powered SMS concierge that recovers missed event meetings automatically.
Live in production at **concierge.vendelux.com** (Vercel).

> Project summary for stakeholder updates: [PROJECT_UPDATE_SOURCE.md](PROJECT_UPDATE_SOURCE.md).
> Vendelux integration plan: [docs/vendelux-integration.md](docs/vendelux-integration.md).
> Agent conventions: [AGENTS.md](AGENTS.md).

## What it does

Clients run booths at industry events and pre-schedule meetings with leads. When
a lead misses a meeting, the client (or an admin on their behalf) marks them
no-show on the campaign dashboard. The system then:

1. Pulls the lead's details from Snowflake (Vendelux's warehouse) and caches
   them in Postgres.
2. Sends a recovery SMS via Clicksend from the event's agent persona.
3. Receives the lead's reply via the Clicksend inbound webhook.
4. Calls the Claude API to classify the conversation and draft a reply.
5. Applies a deterministic state machine to decide the lead's status.
6. Either sends the drafted SMS back via Clicksend, or hands the thread off to
   the FDE in Slack with full conversation context.
7. Runs cron jobs at end-of-day (nudge stalled leads) and end-of-event (offer a
   virtual meeting after the event closes).

The no-show mark only clears when a reschedule or virtual meeting is *confirmed*
in the conversation, not on the first positive reply — multiple back-and-forth
messages are normal before that point.

### Duplicate-phone guardrail

All campaigns text from a single shared Clicksend number, so a lead booked by
two different clients at the same event must never receive texts from "two
people." Defense in depth:

- **Pipeline level** — upstream dedup keeps one lead per phone number in the
  Sigma view (priority: days-to-meeting, team tier, status).
- **App level (client route)** — if a campaign-dashboard user marks a lead whose
  phone already has an active conversation in another campaign, the mark
  *silently succeeds* (dashboard shows no-show) but no SMS is sent. The lead is
  flagged `suppressedAt` and a cron flips it to `canceled` after 1 hour.
  Clients can never discover that another client shares the lead.
- **App level (admin route)** — admins get an honest `409 duplicate_phone`.

## Stack

- Next.js 14 (App Router) + TypeScript, Tailwind for dashboards
- Prisma 6 + PostgreSQL (Neon in production) via the `pg` driver adapter
- Snowflake SDK — read-only access to Vendelux campaign/lead views
- Anthropic SDK with structured tool-use + prompt caching
- Clicksend for SMS, Slack Web API for FDE handoff, Instantly for email (scaffolded, unused)
- Vercel: hosting, serverless functions, cron jobs, custom domain
- Vitest — 75 unit tests

## URL structure & auth

Routes are split by audience, enforced in [middleware.ts](middleware.ts):

| Path | Audience | Auth |
| --- | --- | --- |
| `/admin/login` | Vendelux staff | public |
| `/admin/campaigns` | Vendelux staff | `admin_session` cookie |
| `/admin/activity` | Vendelux staff | `admin_session` cookie — SMS activity feed with message-type filters |
| `/customer/login` | Clients | public |
| `/customer/[teamId]/[eventId]` | Clients + admins | `campaign_session` (scoped to that campaign) or `admin_session` |
| `/dashboard/**` | Internal prototype views | `client_id` cookie |
| `/campaigns/**` | legacy | 301-redirects to the new `/admin` / `/customer` paths |

- **Admin auth** ([lib/auth/admin-auth.ts](lib/auth/admin-auth.ts)) — username/password
  from env (`CAMPAIGNS_ADMIN_USERNAME` / `CAMPAIGNS_ADMIN_PASSWORD`), HMAC-signed
  session token. Placeholder until Auth0.
- **Campaign auth** ([lib/auth/campaign-auth.ts](lib/auth/campaign-auth.ts)) —
  per-campaign credentials in the `CampaignCredential` table; sessions scoped to
  one (teamId, eventId). Create credentials with
  [scripts/create-campaign-credential.mjs](scripts/create-campaign-credential.mjs).
- Both login flows share `POST /api/auth/campaign-login`, which tries admin
  credentials first, then campaign credentials, and returns the right redirect.

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

### Tests

```bash
npm test           # 75 unit tests: state machine, parsers, templates, Snowflake mappers
npm run typecheck  # strict TS
```

### Deployment

Production deploys are manual via `npx vercel --prod` (Git integration is not
auto-deploying). The build script runs `prisma migrate deploy`, so committed
migrations are applied to the production database automatically on deploy.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | Claude API for classification + drafting |
| `CLAUDE_MODEL` | no | Override; defaults to `claude-sonnet-4-6` |
| `CLICKSEND_USERNAME` | yes (for SMS) | Clicksend basic-auth username |
| `CLICKSEND_API_KEY` | yes (for SMS) | Clicksend API key |
| `CLICKSEND_FROM_NUMBER` | yes (for SMS) | Shared sender number |
| `CONCIERGE_INBOUND_NUMBERS` | no | Comma-separated number(s) concierge owns; the inbound webhook ignores messages to any other number. Defaults to `CLICKSEND_FROM_NUMBER`. |
| `SLACK_BOT_TOKEN` | yes (for FDE handoff) | `xoxb-…` token, scopes: `chat:write` |
| `SLACK_DEFAULT_CHANNEL` | no | Fallback channel when a lead has no `fde_owner_slack_id` |
| `SNOWFLAKE_ACCOUNT` | yes | Snowflake account identifier |
| `SNOWFLAKE_USERNAME` | yes | Snowflake user |
| `SNOWFLAKE_PASSWORD` | yes | Snowflake password |
| `SNOWFLAKE_WAREHOUSE` | no | Warehouse (secondary roles are activated automatically) |
| `SNOWFLAKE_ROLE` | no | Role override |
| `CAMPAIGNS_ADMIN_USERNAME` | yes | Admin dashboard login (defaults to `vendelux`) |
| `CAMPAIGNS_ADMIN_PASSWORD` | yes | Admin dashboard password |
| `AGENT_PERSONA_NAME` | no | Fallback agent persona when Snowflake has none |
| `INSTANTLY_API_KEY` | no | Required only when emailing |
| `APP_BASE_URL` | no | Public URL (used for "Open in dashboard" buttons in Slack) |
| `CRON_SECRET` | yes (in production) | Vercel Cron `Authorization: Bearer …` shared secret |

Missing config fails *closed* — the Slack notifier logs a warning and skips
rather than throwing into the webhook async work, and cron routes return 401
when `CRON_SECRET` is unset.

## Architecture

```
app/
├── api/
│   ├── auth/
│   │   ├── campaign-login/route.ts      # admin OR campaign credentials → session cookie
│   │   ├── campaign-logout/route.ts
│   │   ├── sign-in/route.ts             # dev placeholder for /dashboard views
│   │   └── sign-out/route.ts
│   ├── campaigns/[teamId]/[eventId]/leads/[vendeluxLeadId]/noshow/route.ts
│   │                                    # main no-show flow: Snowflake pull → SMS;
│   │                                    # silent suppression on duplicate phone
│   ├── leads/[id]/noshow/route.ts       # legacy/internal flow (admin: hard 409 on dup)
│   ├── webhooks/
│   │   ├── clicksend/route.ts           # inbound SMS → classify → reply or escalate
│   │   └── scheduling/route.ts          # self-rescheduled leads
│   └── cron/
│       ├── eod-checkin/route.ts
│       ├── end-of-event-virtual/route.ts
│       └── cancel-suppressed/route.ts   # suppressed → canceled after 1h TTL
├── admin/                               # Vendelux-staff views
│   ├── login/  campaigns/  activity/
│   └── _components/                     # CampaignsTable, LogoutButton, …
├── customer/                            # client-facing campaign dashboards
│   ├── login/  [teamId]/[eventId]/
│   └── _components/                     # MarkNoShowButton, LogoutButton
├── dashboard/                           # earlier internal prototype views
└── sign-in/                             # dev sign-in for /dashboard

middleware.ts                            # gates /admin, /customer, /dashboard; legacy redirects

lib/
├── auth/
│   ├── admin-auth.ts                    # env-credential admin sessions (pre-Auth0)
│   ├── campaign-auth.ts                 # per-campaign credential sessions
│   ├── campaign-context.ts              # server-component session reader
│   └── context.ts                       # dev client-cookie context for /dashboard
├── core/                                # framework- and DB-free logic
│   ├── conversation-state.ts            # pure (status, classification) → status
│   ├── classifier-prompts.ts            # version-controlled Claude prompt + tool schema
│   ├── outbound-templates.ts            # SMS copy
│   └── types.ts
├── integrations/
│   ├── data.ts                          # LeadRepository interface
│   ├── data.prisma.ts                   # Postgres impl (lead state, conversations)
│   ├── prisma.ts                        # singleton client w/ pg driver adapter
│   ├── snowflake.ts                     # warm connection + query() with timeout
│   ├── campaigns.snowflake.ts           # V_VDX_CAMPAIGN_CONFIG queries
│   ├── leads.snowflake.ts               # SLOANE_LEADS_WITH_POSITIVE_STATUS queries
│   ├── claude.ts                        # Anthropic SDK wrapper, parseClassification
│   ├── clicksend.ts                     # sendSms + parseInboundWebhook
│   ├── slack.ts                         # Block Kit FDE notification
│   └── instantly.ts                     # sendEmail (unused)
├── jobs/
│   ├── eod-checkin.ts
│   └── end-of-event-virtual.ts
└── util/                                # logger, fetch-with-timeout, cron-auth
```

### Data model: Snowflake reads, Postgres owns state

Snowflake is the read-only source of truth for campaigns and leads
(Vendelux Sigma views). Postgres owns everything the concierge creates:
lead status, conversation history, sessions, credentials. When a lead is
marked no-show, its Snowflake row is cached into Postgres
(`cacheSnowflakeLead`) and the dashboard overlays concierge state on the
Snowflake list at render time.

> ⚠️ The app queries live Sigma views. Upstream column renames have broken
> production before (`DATE_MEETING_BOOKED_FOR_1` → `DATE_MEETING_BOOKED_FOR`).
> There is no schema contract or alerting — coordinate with the Data team
> before view changes.

### Lead status state machine

Statuses: `scheduled`, `no_show`, `in_reschedule_convo`, `confirmed_reschedule`,
`in_virtual_convo`, `confirmed_virtual`, `context_question`, `not_interested`,
`uncategorized`, `canceled`.

Rules implemented in [lib/core/conversation-state.ts](lib/core/conversation-state.ts):

- Terminal states (`confirmed_reschedule`, `confirmed_virtual`,
  `not_interested`, `canceled`) are sticky — re-opening a closed thread is an
  FDE decision, not Claude's.
- `scheduled` is pre-no-show; the state machine never transitions out of it.
- `canceled` is reached only via the suppression cron (duplicate-phone leads),
  never via conversation.
- `is_confirmation` only matters for the two reschedule categories.
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

### Message types

Every outbound/inbound message is tagged at creation (`MessageType` enum):
`initial_outreach`, `auto_reply`, `inbound_reply`, `eod_checkin`,
`virtual_offer`. The admin activity feed at `/admin/activity` renders these as
color-coded badges with a type filter.

### Webhook flow (Clicksend inbound)

Two ClickSend numbers are shared across multiple workflows, so the webhook
filters in two layers before acting: it ignores any message delivered to a
number not in `CONCIERGE_INBOUND_NUMBERS` (destination filter), and then only
processes senders who are currently an active no-show lead (sender filter). A
reply to, say, a meeting reminder from someone not mid-no-show conversation is
dropped.

1. Validate JSON + payload schema synchronously.
2. Reject inbound delivered to a non-concierge number (`isConciergeInboundNumber`).
3. Respond `200` immediately via Vercel's `waitUntil`.
4. Async: look up the active no-show lead by phone; if none, drop the message.
5. Build a tentative thread (history + new inbound), classify with Claude.
6. Persist the inbound message with the classification attached (single insert).
7. Apply `nextState`; update lead status if it changed.
8. If `draft_reply` is non-null → send via Clicksend, append outbound row.
9. If `draft_reply` is null → notify FDE via Slack with full thread context.

### Cron jobs

| Path | Schedule (UTC) | Behavior |
| --- | --- | --- |
| `/api/cron/eod-checkin` | `0 23 * * *` | For the current event, follow up with active no-shows whose last inbound is older than 4h. |
| `/api/cron/end-of-event-virtual` | `0 14 * * *` | For events that ended in the last 36h, offer a virtual meeting to active no-shows. Idempotent via a marker phrase. |
| `/api/cron/cancel-suppressed` | `*/15 * * * *` | Flip leads suppressed >1h ago (duplicate phone, no SMS sent) to `canceled`. |

Suppressed leads (`suppressedAt` set) are excluded from both outreach crons.

## API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/campaigns/:teamId/:eventId/leads/:vendeluxLeadId/noshow` | admin or campaign session | Main no-show flow; silent suppression on duplicate phone |
| POST | `/api/leads/:id/noshow` | client cookie + ownership | Legacy flow; hard 409 on duplicate phone |
| POST | `/api/webhooks/clicksend` | none (TODO: shared secret) | Inbound SMS, async classification + reply |
| POST | `/api/webhooks/scheduling` | none (TODO: shared secret) | Lead self-rescheduled via native link → `confirmed_reschedule` |
| GET | `/api/cron/*` | `Bearer $CRON_SECRET` | Cron-only (3 jobs, see above) |
| POST | `/api/auth/campaign-login` | none | Admin or campaign credentials → session cookie + redirect |
| POST | `/api/auth/campaign-logout` | session cookie | Clear session |
| POST | `/api/auth/sign-in` / `sign-out` | none / cookie | Dev placeholder for `/dashboard` views |

## Known gaps / pre-launch checklist

- **Auth0.** Admin and campaign auth use env/DB credentials. Auth0
  "Regular Web Application" setup is the planned replacement.
- **Credential rotation.** Anthropic API key, Snowflake password, and Slack bot
  token were exposed during development and must be rotated before broad rollout.
- **Slack channel.** `SLACK_DEFAULT_CHANNEL` still points at a test channel.
- **Seed data in production.** The production DB still contains seed
  conversations (Alice Johnson et al.) that should be cleaned out.
- **Webhook signature verification.** Clicksend doesn't sign; add a query-param
  secret to both webhook routes.
- **Idempotency on Clicksend inbound.** Retry deliveries can cause duplicate
  classification + reply. Lowest-cost fix: a unique index on a stored
  `provider_message_id`.
- **Single-event cron.** `runEodCheckin` handles one current event per run;
  fan out per event before running many simultaneous campaigns.
- **Instantly email is implemented but not wired.** No caller invokes
  `sendEmail()` yet.
- **Virtual-offer dedup is text-based.** The end-of-event cron dedupes by
  scanning for a marker phrase — fragile to template edits; replace with a
  column when convenient.

## Test coverage

75 unit tests across:

- [tests/conversation-state.test.ts](tests/conversation-state.test.ts) — every
  transition path including pivots, terminal stickiness, and `is_confirmation`
  edge cases.
- [tests/claude-parser.test.ts](tests/claude-parser.test.ts) — Zod schema for
  the tool output + the user-message formatter.
- [tests/clicksend-parser.test.ts](tests/clicksend-parser.test.ts) — webhook
  payload variants (timestamp formats, customstring vs custom_string, malformed
  inputs) and concierge-number matching (`isConciergeInboundNumber`).
- [tests/outbound-templates.test.ts](tests/outbound-templates.test.ts) — SMS
  template formatting.
- [tests/leads-snowflake.test.ts](tests/leads-snowflake.test.ts) — Snowflake row
  mapping and meeting date/time combination.

Integration of Claude, Clicksend, Slack, and Snowflake is not unit-tested —
those are exercised via the dev server + real credentials.
