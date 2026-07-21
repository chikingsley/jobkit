# JobKit roadmap

The roadmap lists unfinished product work. Git history records completed implementation. Codex owns production reasoning, extraction, matching, ranking, research, and drafting as the single production AI dependency.

## Product verification and launch readiness

- [ ] `[BACKFILL-001]` Complete a source-stratified production canary and full Codex backfill for match facts, position analysis, and normalized listing content, including validation and retry reconciliation.
- [ ] `[DOGFOOD-001]` Test the complete application loop with user-owned inboxes: generation, packet attachments, delivery, Gmail threading, reply ingestion, and outcome recording.
- [ ] `[CAMPAIGN-001]` Run one test-only campaign through target selection, first-five review, message generation, paced delivery, Gmail reply ingestion, and reply-driven pause before enabling live campaign delivery.
- [ ] Complete Google's production OAuth verification and security requirements before onboarding public users.

## Post-launch

- [ ] `[SEO-001]` Build the public job-discovery surface with canonical job URLs, accurate `JobPosting` structured data, unique JobKit descriptions, source attribution, freshness and expiry handling, and a login-gated application flow.
- [ ] `[JINA-001]` Revisit Jina only after SEO work is complete. Keep the existing experiments and benchmark evidence; future adoption requires a later evaluation that establishes a clear product advantage over Codex.

## Operator commands

Run `bun run jobkit -- --help` for the canonical command surface. Durable operations belong behind that entry point; archive or delete one-off migration and evaluation scripts after use.
