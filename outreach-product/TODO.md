# JobKit roadmap

This is the canonical list of unfinished product work. Completed implementation
belongs in Git history, not in this file.

## Ship the current application loop

- Validate the Jobs workspace at representative iPad-landscape and desktop
  viewports. The iPad experience keeps the desktop two-pane workspace, compact
  header controls, a collapsible sidebar, and independently scrollable queue
  and detail panes.
- Verify a real application from Jobs through Gmail, including the exact message
  whitespace, attachments, success state, thread ingestion, and reply display.
- Review and send the first 10-20 ranked applications.
- Complete the production Google OAuth project and Google's verification and
  security requirements before onboarding public users.

## Position extraction and ranking

- Run the full-inventory position extractor through the canonical `jobkit` CLI.
  OpenCode with DeepSeek V4 Flash is the high-throughput default; Codex Terra is
  available for audits, difficult listings, and comparison runs.
- Start with a recorded pilot, inspect the extracted evidence and eligibility,
  then drain all listings missing the current analysis schema.
- Recompute ranking after extraction and review false-positive/false-negative
  subject-teacher classifications before enabling unattended applications.

## Contacts and shared recruiters

- Model canonical contacts separately from listings so repeated recruiters and
  shared placement inboxes are visible before sending.
- Treat ANESL as one consultant relationship. Group at most five selected ANESL
  position IDs into one application, following its published instructions,
  rather than emailing `hr@anesl.com` once per listing.
- Show every listing associated with a contact, with the strongest match first,
  without hiding the full descriptions.
- Decode protected email addresses during ingestion and retain the original
  source URL and reference ID for traceability.

## Inventory and campaigns

- Define and deploy the hosted inventory-refresh runner, its schedule, retry
  policy, freshness rules, and observability.
- Connect country and city sweeps to the hosted campaign model: discovery,
  verification, coverage audit, selected contacts, send policy, and outcomes.
- Add a campaign dashboard for queued, reviewed, sent, replied, failed, and
  skipped applications, including per-contact deduplication and rate limits.
- Establish automation levels from manual review through approved-batch send to
  tightly bounded auto-submit.

## Platform hardening

- Keep Base UI as the canonical component primitive layer and shared UI in
  `src/components`. Add another primitive library only when a verified product
  need cannot be met cleanly by Base UI.
- Continue extracting repeated feature-level behavior into shared components,
  hooks, and services when a real reuse boundary exists.
- Test onboarding with a fresh second account, including profile import,
  preferences, documents, OAuth, and first application.
- Archive or reorganize dated audits and superseded design notes after the live
  application loop is stable.

## Operator commands

Run `bun run jobkit -- --help` for the canonical command surface. Ad hoc product
operations belong under `cli/` and must be exposed through that entry point.
