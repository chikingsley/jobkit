# Outreach tracking and product design

Status: Design history. The local-CLI sections document the system JobKit grew from; the hosted
Cloudflare sections describe the current direction. See [`../README.md`](../README.md) for current
commands and implemented behavior.

Notes on how follow-up tracking works, where the state should live (local now, Cloudflare later),
and what this could become as a product. See [`job-search-playbook.md`](job-search-playbook.md)
for the strategy this implements and
[`../../job-search/job-data/outreach-sent/review.md`](../../job-search/job-data/outreach-sent/review.md)
for the data that motivates it.

## 1. Follow-up tracking: who owns what

Gmail does **not** give us follow-up tracking we can build on:

- **Nudges** = a soft UI reminder ("Sent 3 days ago, follow up?"). No cadence rules, no API, not programmable.
- No concept of "this is outreach thread #N, follow-up #2 is due Thursday."

What Gmail *is* the source of truth for: **did they reply?** A thread either has an inbound message
from someone other than us after our send, or it doesn't. The hosted Worker reads that through the
Gmail API after an authenticated Pub/Sub notification.

So the model is **both**, with a clean split of ownership:

| Fact | Owner | How |
|---|---|---|
| What we sent, to whom, when, subject | **our store** | recorded at draft/sync time |
| Did they reply yet | **Gmail** (truth) → cached in our store | thread has an inbound msg |
| When is the next nudge due, how many sent | **our store** | cadence rules (#1 ≥4d, #2 ≥10d, max 2) |
| The drafted nudge itself | **Gmail** (as a draft) | `drafts.create` with `threadId` |

The store is just a cache + scheduler over Gmail-as-truth. Because the module is **draft-first**,
the mailbox is authoritative for "what actually went out" — so a `sync` step scans SENT, detects
replies, and updates the store; `follow-ups` reads the store and drafts in-thread nudges. Nothing
sends; a human reviews and hits send.

### Optional visibility layer: Gmail labels

A nice touch (not required): mirror state into Gmail labels — `outreach/awaiting-reply`,
`outreach/followup-due`, `outreach/replied` — so the campaign is visible in the inbox itself, not
just in our DB. One-way push from the store; cheap, and it makes the system legible without a UI.

## 2. Where the state lives

**Now (personal CLI):** a local **SQLite** file under
`~/github/jobkit/job-search/.cache/outreach/track.db`.
Zero infra, perfect for one user on one machine, and consistent with the repo's local SQLite
source of truth in `job-search/job-data/jobs.sqlite`.
This is what the current build uses. It's the right call until one of these becomes true:

- you want follow-ups to fire **without your laptop on** (autonomous cadence),
- you want it on **multiple devices**, or
- it becomes a **product** with more than one user.

**Hosted JobKit:** the application and reply state now lives in Cloudflare:

| Need | Cloudflare primitive |
|---|---|
| The tracking DB (threads, cadence, outcomes), multi-device | **D1** (SQLite at the edge) — near drop-in for the local schema |
| "Every morning: re-check replies, draft due nudges" with no laptop | **Workers + Cron Triggers** |
| Rate-limited fan-out (compose/draft N schools politely) | **Queues** |
| Per-user stateful campaign agent | **Durable Objects** / **Agents SDK** |
| Tailoring emails / parsing postings | **Workers AI** or Anthropic from a Worker |
| Resume PDFs, attachments | **R2** |
| Config / feature flags / cached OAuth tokens | **KV** / **Secrets Store** |
| Dashboard UI | **Pages / Workers static assets** |

The hosted Worker uses per-user Gmail OAuth, writes verified send/thread state to D1, accepts
authenticated Gmail Pub/Sub pushes, and renews mailbox watches with a Cron Trigger. The local
SQLite tracker remains historical tooling for the separate draft-only outreach CLI.

## 3. The product angle — "what if I built Ben's thing, but software"

You paid Ben for: a codified ESL job-search **playbook**, a tailored **resume**, and **coaching**.
jobkit already automates the first two and has the data to prove the third. As a product it's
basically **"Ben-as-software for ESL job-seekers"**:

**What it does** (the funnel you've already built, generalized):

1. Aggregate live ESL jobs across boards (the `jobs/` pipeline) → normalized + LLM-enriched.
2. Build/tailor a resume to the proven ESL rules (the `resume/` side + the playbook critique).
3. Compose outreach that *enforces the playbook by construction* (open-ended question, targeted
   subject, market focus) and **schedules the follow-ups** — the single biggest lever the data found.
4. Track replies/offers, learn which templates/markets convert, feed that back into the templates.

**The moat is the playbook + the outcomes data.** Anyone can call an LLM; the value is the
hard-won rules from a real practitioner (Ben) *plus* a growing dataset of which emails actually got
offers — so the product gets measurably better at "what to send, to whom, when."

**Stack:** Cloudflare end-to-end (table above) + per-user Gmail OAuth send-as. Workers AI/Agents SDK
for the tailoring; D1 for state; Cron for cadence; R2 for documents; Pages for the dashboard.

**Monetization, Ben-style tiers:**

- *Free* — board aggregation + 1 resume build.
- *Plus* — AI outreach + follow-up automation + tracking dashboard.
- *Coaching* — human-in-the-loop review / contract-math / "run away from this offer" calls (the part
  Ben did personally; could be you, or a vetted coach marketplace).

**Real risks to design around early:**

- **Deliverability & compliance** — automated cold email at scale invites spam filtering, sender-
  reputation damage, and CAN-SPAM/GDPR obligations. Keep it **draft-first / human-in-the-loop** and
  per-user send-as (their own Gmail, their own reputation) rather than blasting from a shared domain.
- **Board ToS** — scraping aggregation has the usual gray-area risk; prefer official APIs where they
  exist (e.g. the ESL Cafe / TEFL JSON we already use) and stay polite.
- **Gmail API quotas & OAuth verification** — sending/large mailbox scans hit quotas; OAuth for a
  public app needs Google verification.

None of this blocks the personal tool — it's draft-first, single-user, local. It's the checklist for
*if* you decide to turn it into the product.
