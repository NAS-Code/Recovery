# Vendelux Concierge — No-Show Recovery
## Project Update Source Document

> **Purpose of this file:** Source-of-truth project summary, structured to fill out the
> Vendelux "AI Project Update" template (Overview → Why It Matters → Definition of
> Success → Cross-Team Asks → Where We Are). Provide this file to Claude along with
> the template and it has everything it needs. Items marked `[FILL]` need a human
> answer before or after generation.

---

## 1. Overview

**Project name:** Vendelux Concierge — No-Show Recovery

**Tagline:** AI-powered SMS concierge that recovers missed event meetings automatically.

**What we're building:**
An automated SMS recovery service for Vendelux's event concierge business. When a lead
no-shows a booked meeting at a conference, the system texts them within minutes from
the event's agent persona, holds a natural two-way SMS conversation powered by Claude,
and drives them to either rebook an onsite meeting or accept a virtual meeting after
the event. Humans (FDEs) are pulled in via Slack only when the AI can't confidently
handle a reply.

**How it works (one paragraph):**
A client or admin marks a lead as a no-show on the campaign dashboard. The system pulls
the lead's details from Snowflake (Vendelux's data warehouse), sends a personalized
recovery text via ClickSend, and stores the conversation state in Postgres. When the
lead replies, Claude classifies the message intent (reschedule onsite / virtual meeting /
question / not interested) and auto-drafts a reply for the actionable intents.
Daily cron jobs send end-of-day check-ins during the event and virtual-meeting offers
after the event ends. Clients watch it all happen live on their dashboard.

**In scope:**
- SMS-only outreach and conversation (single shared sender number via ClickSend)
- Claude-based intent classification and auto-reply for reschedule/virtual/context intents
- Slack escalation to FDEs for uncategorized or sensitive replies
- Client-facing campaign dashboards (per team + event) and internal admin dashboards
- Automated cadence: initial outreach → EOD check-in → post-event virtual offer
- Duplicate-phone guardrails (one lead can never receive texts from two clients)

**Out of scope (currently):**
- Email outreach (Instantly integration is scaffolded but unused)
- Voice / phone calls
- Multiple sender numbers per client
- Self-serve campaign creation by clients
- Auth0 / SSO login (deferred; using credential-based auth today)

**At a glance:**
| Field | Value |
|---|---|
| Stage | Pilot — deployed to production at `concierge.vendelux.com` |
| Target launch | `[FILL — first live event/campaign date]` |
| Team / owner | `[FILL — e.g. FDE team · Nick Sartini]` |
| Key stakeholders | `[FILL — FDE team, Data team, client CSMs]` |

---

## 2. Why It Matters

**The problem (one sentence):**
Booked meetings at events are expensive to win, and when a lead no-shows, that
investment is lost — today recovery depends on a human noticing and chasing manually.

**Pain point:**
No-show rates at conferences are high, and onsite teams are too busy running the booth
to chase no-shows by hand. Follow-up is inconsistent, slow (hours or days, when minutes
matter), and doesn't scale across simultaneous campaigns.

**Who it affects:**
- **Clients** paying Vendelux for booked meetings that don't happen
- **FDEs / onsite contact managers** burning time on manual chasing
- **Vendelux** — meeting-completion rate is the product's core value metric

**Cost of inaction:**
Every unrecovered no-show is a lost meeting the client paid for. Lower
meetings-completed counts directly threaten campaign renewals and the perceived ROI of
the concierge service.

---

## 3. Definition of Success

**Success criteria:**
- No-show leads receive a personalized recovery text within minutes of being marked, with zero manual effort
- A meaningful share of no-shows are recovered into completed onsite or virtual meetings
- FDEs only touch conversations the AI escalates — not every reply
- Clients can self-serve campaign visibility through their dashboard instead of asking for status

**Metrics to track:**
| Metric | Target |
|---|---|
| No-show recovery rate (recovered ÷ marked) | `[FILL — e.g. 25%]` |
| Median time from no-show mark → first text | < 5 minutes |
| % of inbound replies handled without human escalation | `[FILL — e.g. 70%]` |
| Meetings completed per campaign (uplift vs. pre-tool baseline) | `[FILL]` |

---

## 4. Cross-Team Asks

`[FILL — confirm owners and dates; suggested asks below based on current project state]`

| Team | What we need | Why | Needed by |
|---|---|---|---|
| Data | Stability/change notifications for the Sigma views we read (`SLOANE_LEADS_WITH_POSITIVE_STATUS`, `V_VDX_CAMPAIGN_CONFIG`) — a recent silent column rename broke production | App reads these views live; schema drift = outage | `[FILL]` |
| Data | Keep upstream phone-number dedup (one lead per number across clients) in the pipeline | First line of defense against double-texting a lead from two clients | `[FILL]` |
| IT / Security | Auth0 "Regular Web Application" setup for proper SSO | Replace credential-based login for admins and clients | `[FILL]` |
| CSM / Client teams | Distribute campaign dashboard credentials to pilot clients and collect feedback | Validates the client-facing experience | `[FILL]` |

---

## 5. Where We Are

**Status:** On track — live in production.

**Done:**
- End-to-end no-show flow live: mark → Snowflake pull → SMS send → conversation tracking
- Claude classifier with five-intent model and auto-reply drafting
- Slack escalation for replies needing a human
- Client campaign dashboards + internal admin dashboards, with separated `/admin` and `/customer` URL structures
- SMS activity feed with message-type tagging (initial outreach, auto-reply, inbound, EOD check-in, virtual offer)
- Automated cadence crons: EOD check-in (daily, 23:00 UTC) and post-event virtual offer (daily, 14:00 UTC)
- Duplicate-phone guardrail: silent suppression + auto-cancel so a lead shared by two clients is never double-texted and clients can't discover the overlap
- Production deployment on Vercel with custom domain and auto-applied DB migrations

**In progress:**
- Production hardening: rotating exposed credentials, cleaning seed/test data from production DB
- Switching Slack escalation from test channel to production channel

**Up next:**
- Auth0 integration for proper authentication
- First live campaign with real client traffic `[FILL — which event?]`
- Recovery-rate reporting once live data accumulates

**Risks / blockers:**
- **Snowflake schema drift** — upstream view changes have broken prod once already; no contract or alerting exists
- **Single shared sender number** — all campaigns text from one number; guardrails mitigate cross-client collisions but a per-client number strategy may be needed at scale
- **Credential rotation pending** — API keys exposed during development must be rotated before broad client rollout
- **Auth0 dependency** — needs outside help to create the Auth0 application

---

## Appendix — Tech Stack (for reference)

| Layer | Tool | Role |
|---|---|---|
| AI | Claude (Anthropic API) | Classifies inbound SMS intent, drafts replies |
| SMS | ClickSend | Outbound/inbound text messages, single sender number |
| Data warehouse | Snowflake | Read-only source of leads & campaign config (Sigma views) |
| App database | Postgres (Neon) via Prisma | Lead state machine, conversation history, sessions |
| Escalation | Slack (Web API) | FDE handoff when AI can't auto-reply |
| Hosting | Vercel | Next.js 14 app, serverless functions, cron jobs |
| Framework | Next.js 14 (App Router) | Admin + customer dashboards, API routes, middleware auth |
