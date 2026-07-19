# JobKit roadmap

This is the canonical list of unfinished product work. Completed implementation
belongs in Git history, not in this file.

## Ship the current application loop

- [ ] `[FLOW-010]` Validate the Jobs workspace at representative iPad-landscape and desktop
  viewports. The iPad experience keeps the desktop two-pane workspace, compact
  header controls, a collapsible sidebar, and independently scrollable queue
  and detail panes.
- [ ] `[FLOW-012] [FLOW-021] [FLOW-022]` Move ANESL from its standalone workspace into campaign
  execution. Rank eligible ANESL positions for the selected markets, group the
  best one to five references into one intermediary email, and expose the
  resulting bundle in campaign activity and Messages.
- [ ] `[FLOW-010]` Review and send the first 10-20 ranked applications.
- [ ] `[FLOW-001] [FLOW-010] [FLOW-030]` Complete the production Google OAuth project and Google's verification and
  security requirements before onboarding public users.

## Position extraction and ranking

- [ ] `[FLOW-010] [FLOW-040]` Run the full-inventory position extractor through the canonical `jobkit` CLI.
  OpenCode with DeepSeek V4 Flash is the high-throughput default; Codex Terra is
  available for audits, difficult listings, and comparison runs.
- [ ] `[FLOW-010] [FLOW-040]` Start with a recorded pilot, inspect the extracted evidence and eligibility,
  then drain all listings missing the current analysis schema.
- [ ] `[FLOW-010] [FLOW-021]` Recompute ranking after extraction and review false-positive/false-negative
  subject-teacher classifications before enabling unattended applications.

## Contacts and shared recruiters

- [ ] `[FLOW-010] [FLOW-021]` Finish the contact workspace so every recruiter or intermediary shows all
  associated listings with the strongest match first and full descriptions
  available.
- [ ] `[FLOW-010] [FLOW-021] [FLOW-022]` Finish canonical-contact coverage so repeated recruiters and
  shared placement inboxes are visible before sending.
- [ ] `[FLOW-010] [FLOW-040]` Decode protected email addresses during ingestion and retain the original
  source URL and reference ID for traceability.

## Inventory and campaigns

- [ ] `[FLOW-021] [FLOW-022]` Build the Campaigns master-detail workspace: campaign list and
  status on the left, selected campaign results and controls on the right, and
  a separate resumable new-campaign route.
- [ ] `[FLOW-040]` Define and deploy the hosted inventory-refresh runner, its schedule, retry
  policy, freshness rules, and observability.
- [ ] `[FLOW-020] [FLOW-021] [FLOW-022] [FLOW-030]` Connect country and city sweeps to the hosted campaign model: discovery,
  verification, coverage audit, selected contacts, send policy, and outcomes.
- [ ] `[FLOW-021] [FLOW-022]` Replace the fixed-size review batch with the full
  live eligible target pool. Calibrate the first five messages, execute at the
  configured daily pace, and pause after three human replies; bounces and
  automated replies do not count.
- [ ] `[FLOW-022] [FLOW-030]` Extend the campaign dashboard into eligible, queued, sent, human-replied,
  failed, skipped, exhausted, and paused states. Claim each execution globally
  so overlapping campaigns cannot contact the same recipient or opportunity
  twice.
- [ ] `[FLOW-022]` Establish automation levels from manual review through approved-batch send to
  tightly bounded auto-submit.

## Platform hardening

- [ ] Keep Base UI as the canonical component primitive layer and shared UI in
  `src/components`. Add another primitive library only when a verified product
  need cannot be met cleanly by Base UI.
- [ ] Continue extracting repeated feature-level behavior into shared components,
  hooks, and services when a real reuse boundary exists.
- [ ] `[FLOW-010]` Add an opt-in sent-message scan that proposes voice preferences while the
  approved JobKit message foundation remains authoritative.
- [ ] `[FLOW-001]` Test onboarding with a fresh second account, including profile import,
  preferences, documents, OAuth, and first application.
- [ ] Archive or reorganize dated audits and superseded design notes after the live
  application loop is stable.

## Operator commands

Run `bun run jobkit -- --help` for the canonical command surface. Ad hoc product
operations belong under `cli/` and must be exposed through that entry point.
