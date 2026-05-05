# Vendelux integration plan

This service was built standalone as a prototype. This doc captures the work
required to integrate it into the broader Vendelux platform, the path we're
taking, and the open questions for the platform team.

## Stack alignment

| | Vendelux platform | Concierge prototype | Action |
| --- | --- | --- | --- |
| Backend | Django + DRF + django-ninja | Next.js App Router | Keep separate (Path A) |
| Language | Python 3.9+ | TypeScript | Keep |
| Primary DB | MySQL | Postgres | Move to API client (read-through) |
| Warehouse | Snowflake (`django-snowflake`) | n/a | Emit analytics events |
| Frontend | Vite + React 18 + pnpm + RTK Query + MUI/Shadcn | Next.js + Tailwind + npm | Keep for now; port if folded into main UI |
| Auth | Auth0 (authlib JWT in `events/auth.py`) | Cookie placeholder | Swap to `@auth0/nextjs-auth0` |
| Async | Celery + Redis | `waitUntil` | Keep for prototype |
| Deploy | AWS ECS via Pulumi, Docker in ECR | Vercel | Vercel for now; reconsider at Path B |
| Observability | Datadog + Sentry + PostHog | JSON-line logger | Add when productionizing |
| Data orchestration | Dagster Cloud | n/a | Emit Snowflake events; integrate with Dagster |

## V1.0 scope (revised)

Originally I assumed concierge would call Vendelux's Django REST API for read
data. After surveying the actual Snowflake schema, **reads come from Snowflake
views directly** — Vendelux already aggregates exactly what we need.

### Read sources (Snowflake)

| What | View | Filter |
| --- | --- | --- |
| Active campaigns | `SILVER.SLOANE_V2.V_VDX_CAMPAIGN_CONFIG` | `event_date_end >= CURRENT_DATE` |
| Leads for a campaign | `DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS` | `TEAM_ID = ? AND EVENT_ID = ?` |
| Lead phone numbers | Same view: `NUMBER_DIALED` column | — |

A "campaign" is the natural composite `(team_id, event_id)`. Concierge reads
both views as live data — no caching, no replication, no Django middleman.

### Write surface (concierge state, side-stored in Postgres)

When concierge marks a lead `no_show`, transitions through reschedule states,
or updates a meeting time, that state lives **only in concierge's Postgres**
— it does not push back to Vendelux MySQL. Vendelux's view of the lead's
status (`Meeting Booked`, `Meeting Initiated`, etc.) stays unchanged.
Concierge's status (`no_show`, `confirmed_reschedule`, etc.) is an
orthogonal layer FDEs see only via the concierge dashboard.

This is "pure side-store" — chosen over full bidirectional sync because:

- It avoids modifying Vendelux's MySQL schema during prototype validation
- Concierge state is fundamentally a different concept (recovery flow, not
  lead lifecycle)
- Removing or rolling back concierge has zero impact on Vendelux

If we later want analytics consistency, emit concierge state changes into
Snowflake via Dagster (Phase 4 below). Don't push to MySQL.

### "Active" campaign definition

`event_date_end >= CURRENT_DATE`. Once the event is over, no-show recovery is
done by definition — the cron-driven end-of-event virtual offer fires on the
last day, then the campaign falls out of the picker. Sub-campaign / Instantly
campaign status fields are irrelevant to concierge.

### What stays the same

- State machine (`lib/core/conversation-state.ts`)
- Claude classifier prompt + tool schema
- Webhook handlers (Clicksend in/out, scheduling)
- Cron jobs (EOD checkin, end-of-event virtual)
- Conversation table in Postgres

### What changes

- New `lib/integrations/snowflake.ts` — connection pool, query helpers
- New `CampaignRepository` interface, Snowflake-backed implementation
- Refactor `LeadRepository`:
  - `getLeadsForCampaign(teamId, eventId)` reads from Snowflake
  - `getLead`, `getActiveLeadByPhone` etc. read from concierge Postgres
    (cached on first noshow mark)
  - `appendMessage` and conversation history continue to live in Postgres
- New page `/campaigns` lists active campaigns (replaces `/dashboard` index)
- `/campaigns/[teamId]/[eventId]` is the per-campaign dashboard
- Mark-no-show flow: caches the Snowflake lead row into concierge Postgres
  on first click, then operates as today

### Required Snowflake credentials

- `SNOWFLAKE_ACCOUNT` (e.g., `hxanzth-plb04418` from the Sigma metadata)
- `SNOWFLAKE_USERNAME`
- `SNOWFLAKE_PASSWORD` (or keypair — recommend keypair for prod, password for prototype)
- `SNOWFLAKE_WAREHOUSE` (likely a small warehouse for OLTP-style queries)
- `SNOWFLAKE_DATABASE` (`SILVER` for the campaign views, `DATA_OPS` for the
  Sigma leads view — the queries cross databases)
- `SNOWFLAKE_ROLE` (read-only role with `SELECT` on the views above)

### Open items deferred past V1.0

- **Auth swap to Auth0.** Stays as cookie placeholder for V1; the cookie now
  picks a `team_id` (from Snowflake) instead of a Postgres `client_id`. Real
  Auth0 integration is Phase 1 (below).
- **`mysql_user_id` joins.** The Sigma view exposes `LEAD_ID` as the
  Vendelux-side identifier. If the noshow API ever needs to talk back to
  Vendelux MySQL, that's the join key. Not needed for pure side-store.
- **Snowflake credit cost.** Each campaign list and lead list query spins up
  the warehouse. For low-volume prototype, cost is trivial. At scale we'd
  add a short-lived in-process cache (~30s TTL).

## Decision: Path A — standalone service, calls Vendelux APIs

Concierge stays Next.js on Vercel and consumes Vendelux's existing Django REST
API for everything that has a source-of-truth in the main system (Prospects,
Events, Auth). Local Postgres survives only for data Vendelux doesn't yet
model — primarily SMS conversation history.

### Rationale

- The prototype is built and validated. Rewriting into Django before it has
  proven business value is premature.
- The `LeadRepository` and `ClientContext` abstractions were designed for
  exactly this: swap the data and auth providers without touching the core
  logic.
- Concierge is naturally a sidecar — it owns SMS/AI orchestration, not lead
  management. Sidecars don't need to be in the monorepo.

### When to revisit (Path B trigger)

Move concierge into `events/concierge/` as a Django app when any of these
become true:

- Concierge needs to subscribe to MySQL Lead/Event change events in real time
- The dashboard becomes a primary surface and clients expect parity with
  Vendelux's main UI (branding, navigation, permissions)
- Operational cost of running two deployments outweighs porting cost
- Concierge accumulates >2 of its own first-class data tables that would be
  cleaner in MySQL with the rest

## Phase 1 — Auth0

- Install `@auth0/nextjs-auth0`.
- Replace the cookie reader in [lib/auth/context.ts](../lib/auth/context.ts)
  with `getSession()` from the SDK. Keep the same `ClientContext` shape.
- `clientId` derives from the Auth0 `org_id` claim (Vendelux uses Auth0
  Organizations for multi-tenant). Confirm exact claim path with
  `events/events/auth.py`.
- Configure the Auth0 application:
  - Same tenant as production Vendelux
  - Callback URL: `https://<vercel-domain>/api/auth/callback`
  - Logout URL: `https://<vercel-domain>`
- Delete the placeholder `/sign-in` page and `/api/auth/sign-in` route.
- Replace ownership check in `/api/leads/[id]/noshow` to compare
  `lead.clientId` against `org_id` from the JWT.

**Open questions for platform team:**

- Which Auth0 tenant/application should concierge use — share with the main
  app or its own?
- What Auth0 organization claim shape do you use today (`org_id`,
  `https://vendelux.com/org`, custom)?
- Are there scopes/permissions concierge should require for noshow access?

## Phase 2 — Vendelux API client (`VendeluxApiRepository`)

New file `lib/integrations/data.vendelux.ts` implementing `LeadRepository`
against the Django API. Selected by env var (`DATA_BACKEND=vendelux`).

Required endpoints (need to survey `events/events/internal_api/` and
`events/events/partner_api/` to confirm names):

- `GET /api/.../prospects/{id}` → `getLead`, `getLeadByPhone`
- `GET /api/.../prospects/{phone}/by-phone` → `getActiveLeadByPhone` (may not exist; might need adding)
- `PATCH /api/.../prospects/{id}/status` → `updateLeadStatus`
- `PATCH /api/.../prospects/{id}/scheduled-meeting-time` → `updateScheduledMeetingTime`
- `GET /api/.../events/{id}` → `getEvent`
- `GET /api/.../events/current?clientId=...` → `getCurrentEventForClient`
- `GET /api/.../events/{id}/prospects` → `getLeadsForEvent`
- `GET /api/.../prospects/active-no-shows` → `getActiveNoShows`, `getMidConversationLeads`
- `GET /api/.../events/recently-ended?lookbackHours=...` → `getRecentlyEndedEvents`
- `GET /api/.../organizations/{id}` → `getClient`
- `GET /api/.../organizations` → `listClients` (admin only; concierge may not need this)

Authentication forwards the user's Auth0 access token. For cron jobs that
have no user context, use a machine-to-machine token (Auth0 client
credentials grant, scope-limited).

**Naming alignment:** rename concierge's `Lead` type to `Prospect` to match
Vendelux's terminology (their `events/events/models/prospect.py`). The state
machine, prompts, and templates stay unchanged.

## Phase 3 — Conversation persistence

Vendelux's MySQL doesn't have an SMS conversation table today. Three options:

1. **Add it to Vendelux.** PR to events repo: new `Conversation` Django model
   + REST endpoints. Cleanest long-term — conversations sit next to Prospects.
2. **Keep Postgres as a side-store.** Concierge keeps its own Conversation
   table. Cross-references Prospects by id. Simpler short-term; harder to
   query across systems.
3. **Push to Snowflake only.** Treat conversations as analytics events with no
   transactional store. Loses ability to read history at runtime; not viable
   while Claude needs full thread context.

**Recommendation:** Option 1, but it's blocked on platform team capacity.
Option 2 in the interim — Postgres on Vercel Postgres, scoped to `Conversation`
only.

## Phase 4 — Snowflake analytics emission

When concierge state changes (no-show marked, recovery confirmed, virtual
offer sent, lead declined), emit an event into Snowflake for downstream
analytics. Pattern to mirror: `data/sloane_outreach_v2/` already does
something analogous for outbound.

Implementation:

- Add `lib/integrations/snowflake.ts` that posts events to a queue (Kafka,
  per the events repo's existing `kafka-python-ng` usage) or directly via a
  Snowflake stream
- Wrap key transitions: state-machine output, cron job results, FDE handoffs
- Schema lives in the data repo's dbt models — coordinate with data team

## Phase 5 — Observability parity

Defer until Phase 1+2 are productionized. Then:

- Datadog: `@datadog/browser-rum` (frontend) + `dd-trace` (backend Node)
- Sentry: `@sentry/nextjs`
- PostHog: `posthog-js` for client-side product analytics

Match the events repo's setup — same DSNs, same environment naming, same
log forwarding.

## Smaller alignment items, doable now

- **Switch `npm` → `pnpm`** to match `events/frontend`. Cheap diff.
- **Add `lefthook.toml`** for pre-commit Prettier + tsc — events repo uses
  this.
- **Add Prettier** alongside ESLint. Events frontend has both.
- **`.envrc`** with `direnv` for local env vars (events repo convention).
  Optional; `.env` works fine for prototype.
- **`.zz-claude/` directory** for transient agent files. Already gitignored
  via the `.zz` prefix convention noted in [AGENTS.md](../AGENTS.md).

## Tracking

Each phase becomes a tracked issue once we have a project board. For now,
this doc is the source of truth for the integration roadmap.
