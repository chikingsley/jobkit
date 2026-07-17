# JobKit System Audit — 2026-07-16

Full-system audit of the outreach product and job-search pipeline after the 2026-07-16 inventory push (commits `21501a1`, `7c9f1d6`). Four parallel deep-dives: data paths, analysis pipeline, lifecycle logging/UX, and local agent infrastructure. Live D1 numbers verified read-only against production.

## Live production state

| Metric | Value |
|---|---|
| Jobs in D1 | 2,676 (2,673 loaded 07-16 via `inventory:sync`, 3 earlier curated) |
| Application routes | 3,627 (board_form 1,512 / external_url 1,010 / email 950 / login_gated_form 155) |
| Jobs with requirements analysis (`job_match_facts`) | **24 (0.9%)** — all written manually 07-16 08:43–08:47 UTC |
| Jobs with raw salary text / normalized compensation | 2,380 / 1,480 |
| Application drafts | 190 (append-only, versioned) |
| Applications sent | 3 (Hungary/Converzum, Poland/Quest, Albania/AIS) |
| Organizations / campaigns / sweep tasks | **0 rows** — pipeline built, never run |

## Data paths: local → production

| Dataset | Path | Status |
|---|---|---|
| Jobs + queue + routes | `bun run inventory:sync --remote` (`outreach-product/scripts/job-inventory/`) reads `job-search/job-data/jobs.sqlite` (active rows), transforms (salary parse, market segments), writes via `wrangler d1 execute`. Upsert-idempotent, never deletes. | **Works. Manual. Undocumented in any README.** Auth = local Cloudflare creds. |
| SeriousTeachers → `/api/import` | `bun run seed:private` (`scripts/sync_private_board.py`) | **DEAD.** Sends `x-jobkit-admin` header that the worker never implemented; auth middleware (added 07-14) accepts only session cookies or `jobkit_runner_*` tokens → 401. This is the path the README documents. |
| Orgs / contacts / campaigns | `bun run sweeps:run` (`scripts/run-country-sweeps.ts`) claims tasks from `/api/country-sweep-tasks/*` with a runner token, runs Codex, posts results back | Built (migration `0016`), deployed, **never run once**. |
| Outreach corpus (`job-data/outreach-sent/corpus.md`, `review.md`) | none | Lessons hand-transcribed into prompt prose (`33cb5de`); no data feed. |
| Country-sweep workbook (`job-data/country-sweeps/tajikistan/2026-05-11/*.xlsx`, 174 leads, 21 markets) | none | Disconnected research artifact. |
| Resumes / profile | in-app upload → Mistral OCR → profile extraction | No disk path; `job-search/resumes/` is not a runtime input. |
| Job economics evaluation | `bun run economics:evaluate` | Analysis-only, prints JSON, writes nothing. |

## The requirements-analysis break (why "Japanese speaker required" tops the list)

The extraction itself is real and decent: `worker/ai/job-fact-extraction.ts` extracts typed requirements (degree/language/residency/citizenship/experience, required vs preferred) with literal-quote evidence validation, plus economics via `job-economics-extraction.ts`. Model: Cerebras `gemma-4-31b` (fallback `zai-glm-4.7`), server-side.

But there are only three write paths to `job_match_facts`, and none covers the bulk data:

1. `/api/import` analyzes per-job but **silently swallows extraction failures** (`worker/services/job-analysis.ts:38-53`) — and the bulk load didn't use it anyway.
2. `POST /api/jobs/analyze` is capped at **4 jobs per call** (`MAX_ANALYSES_PER_REQUEST`, `job-analysis.ts:55`) and **nothing in the frontend ever calls it**. No cron, no queue, no retry. The 24 analyzed jobs = ~6 manual curls.
3. `inventory:sync` (how the 2,673 jobs arrived) writes jobs/routes directly to D1 and **never touches analysis**.

Downstream, the evaluator is **fail-open by omission**: an unanalyzed job gets one "requirements not analyzed" unknown → neutral "Needs verification" badge, is *not* labeled Ineligible, passes the default filter, and — with listing-derived pay — sorts to the top under the new default "Highest USD/hour" order. Hard blockers (language, residency, degree) are invisible until analysis runs. A green "Strong match" cannot appear without analysis, but nothing *demotes* the unanalyzed either.

## Lifecycle logging (training-data question)

- **Kept:** drafts are append-only and versioned; revise supersedes the old row and stores the user's revision instruction verbatim (`application_drafts.revision_instruction`). Original→instruction→result training pairs are fully reconstructable. Nothing is purged.
- **Kept:** approve/send events (`email_approved`, `email_sent` with verified Gmail IDs, `submitted`, `submission_failed/reconciled`); sent-payload SHA-256 fingerprint (hash only; content recoverable from draft + attachment manifest).
- **Missing:** hand-editing a draft. The message textarea is read-only (`job-detail.tsx:261`); the only edit path is LLM revise. (UI copy says "edit the message" — false.) No endpoint accepts a user-authored body, so direct human edits — the most valuable training signal — cannot happen or be logged.

## Review-flow / post-send gaps vs the vision

| Wish | Status |
|---|---|
| Sent/applied folder, days-elapsed, awaiting-reply | **Missing in UI.** Applied jobs stay in the review queue with a badge. Server already has `GET /api/email-attempts?status=sent|attention` — zero UI consumers. `sent_at` stored, never shown. |
| Follow-ups (3–5 day) | **Missing in product** (no cron/scheduled handler at all). Working draft-only follow-up ledger exists in `job-search/src/jobkit/outreach/track.py` (4/10-day cadence, max 2, bounce/auto-reply aware) + design doc `outreach-product/docs/outreach-and-product-design.md`. Not wired. |
| Reply tracking / Indeed-style message threads | **Missing.** `gmail_message_id`/`gmail_thread_id` captured on every send but nothing syncs replies; `reply_detected` is PRD-only. No thread UI. |
| Three-tier message system | **Half-built.** Routes `advertised_position` / `multi_position` / `school_outreach` exist in schema, prompts, and validators — but the importer hardcodes `advertised_position`, nothing ever assigns `school_outreach`, and a recruiter-reply tier doesn't exist. Audience taxonomy (kids/teens/college/adults) exists for matching only, not generation. |
| Country campaigns ("hit Lithuania") | **Built, unexercised.** Migration `0016` (organizations, contacts, campaigns, sweeps, targets), runner-token auth, `sweeps:run` Codex runner, Automation-page token UI. 0 rows everywhere. |

## Local agent infrastructure (for the local-analyzer plan)

- **OpenCode 1.18.2**: `opencode run` (non-interactive, `--format json`, `-m provider/model`), `opencode serve` (headless HTTP). Models live now: `opencode-go/glm-5.2`, `opencode-go/deepseek-v4-flash|-pro`, `google/gemini-3.5-flash` (plus kimi/qwen/minimax). Note: `zai-coding-plan` (direct GLM subscription) is authenticated but not in `enabled_providers`.
- **Codex 0.144.5**: `codex exec`; OpenAI models only (`gpt-5.6-sol|luna|terra`, …).
- **Bridge template**: `job-search/src/jobkit/gmail_bridge/` — Better Auth sign-in, typed fail-closed client, `watch` poll loop. This is the pattern to copy for any local worker.
- **Transport**: Tailscale mesh (this box = gmk-server). No cloudflared installed.
- **Gap**: the worker has **no endpoint accepting externally-computed match facts**. Only server-internal analysis can write `job_match_facts`. A local analyzer needs one new authenticated writeback route validating `JobMatchFactsSchema` (evidence re-validation server-side).

## TODO (priority order)

1. **Backfill requirements analysis for 2,652 jobs — the trust blocker.** Add an authenticated `POST` writeback endpoint for `JobMatchFactsSchema` (server re-validates evidence quotes against the stored listing). Build a local analyzer worker on the gmail_bridge pattern: OpenCode `glm-5.2` walking jobs one-by-one, Gemini 3.5 Flash / DeepSeek as fallback lanes. Alternative interim: loop `POST /api/jobs/analyze` (4/call, Cerebras) from a local script — no code changes, but server-side models and slower.
2. **Fix fail-open matching.** Unanalyzed jobs must not surface as top prospects: label "Not analyzed," default-sort analyzed-first or add an analyzed-only toggle, and treat required-blocker conflicts as Ineligible once facts exist.
3. **Drafting inputs (carried from 07-15 audit).** Pass `user_preferences` and the profile `introduction` into generation; wire route assignment so `school_outreach` and `multi_position` actually fire; add recruiter-reply as a route; feed audience (kids/university/adults) into the prompt.
4. **Hand-edit path for drafts.** Editable message + endpoint accepting a user-authored body, logged as a new version with `edited_by_user` — closes the loop on training-pair capture.
5. **Sent view.** Tab/folder for applied jobs using the existing unused `GET /api/email-attempts` API: sent date, days elapsed, awaiting-reply state.
6. **Reply sync.** Local bridge worker using `track.py` detection logic against stored `gmail_thread_id`s, posting `reply_detected` events back to D1. Unlocks the Indeed-style thread view later (shadcn message components).
7. **Follow-ups.** Port the 4/10-day cadence from `track.py` into the same bridge worker; draft-first (never auto-send follow-ups initially).
8. **Run one country campaign end-to-end** (Lithuania or Oman) through the existing sweep pipeline to shake it out: token → sweep → orgs/contacts → validate → campaign targets.
9. **Cleanup.** Remove or fix dead `seed:private` (`x-jobkit-admin`); document `inventory:sync` in README; drop stale `.dev.vars` keys (GROQ, GOOGLE_GENERATIVE_AI unused by worker code — the latter IS used by opencode locally, keep clarity on which env is whose).
10. **Decide backend location later.** Local-first Vite + tunnel is viable (Tailscale exists; cloudflared would need install), but the deployed worker just absorbed the full inventory and works. Revisit only if bridge friction becomes the bottleneck.

## Open product decisions

- Campaign sizing: 20–50/day target is fine for board_form submissions (no Gmail involvement, 1,512 jobs) but email lanes should ramp inside Gmail cold-send limits (~50/day start, watch bounce rate).
- Message tiers: confirm the third tier's question wording ("are you currently interested" vs "are you currently hiring") — user prefers the former for cold school outreach.
- Whether analysis backfill should also refresh economics (`schema_version` bumps invalidate old facts by design).
