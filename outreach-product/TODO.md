# JobKit roadmap

This is the canonical list of unfinished product work. Completed implementation
belongs in Git history, not in this file.

## Codex companion and task migration

- [ ] Add task-specific image artifacts for Codex document vision without
  granting the companion access to the checkout, unrelated files, or provider
  secrets.

## Test Lab, Jina, and document extraction

- [ ] Build a versioned evaluation corpus of synthetic, shadow-copied, consented,
  and publicly licensed cases with labeled outputs for job extraction, matching,
  contact discovery, duplicate detection, message revision, and documents.
- [ ] Implement recorded Codex-only, Jina-only, and hybrid trials for Jina
  Reader, Search, embeddings, reranking, classification, deduplication, and
  DeepSearch. Track accuracy, evidence fidelity, completeness, latency, usage,
  stability, multilingual behavior, prompt-injection resistance, and human
  preference. Promote each capability separately only from measured results.
- [ ] Use deterministic text extraction first for born-digital documents. For
  scanned and layout-heavy documents, benchmark Codex vision on rendered pages
  against Mistral OCR, record page-level evidence and failure modes, then remove
  or formally promote the winner.
- [ ] Build an authenticated Test Lab for reset, replay, inspection, side-by-side
  comparison, diffs, fixtures, and benchmark provenance.
- [ ] Build an exact MIME delivery sink with allowlisted user-controlled inboxes,
  simulated provider events, bounces, automated replies, and human replies.
  Real-school recipients and real applications remain disabled.

## Campaign workspace and execution

- [ ] `[FLOW-021] [FLOW-022]` Replace the prototype campaign surface with the
  production master-detail workspace, resumable new-campaign route, multi-country
  full eligible pools, clear activity states, and shared responsive panes.
- [ ] `[FLOW-021] [FLOW-022]` Calibrate the first five messages, carry approved
  reusable feedback into later drafts, and execute at the user-configured daily
  pace until the campaign is paused, stopped, exhausted, or reaches its saved
  human-reply rule.
- [ ] `[FLOW-022] [FLOW-030]` Implement one authoritative execution claim across
  overlapping campaigns. Deduplicate opportunities, canonical contacts, routes,
  ANESL references, and recipients without truncating eligible pools.
- [ ] `[FLOW-012] [FLOW-021] [FLOW-022]` Move ANESL into campaign routing: rank
  eligible references, group the best one to five into one intermediary email,
  and expose the bundle and its single Gmail thread in Campaigns and Messages.
- [ ] `[FLOW-020] [FLOW-021] [FLOW-022]` Connect country and city discovery,
  verification, coverage audits, advertised jobs, cold school contacts, and
  outcomes to campaign admission and freshness.
- [ ] `[FLOW-010]` Finish canonical-contact coverage, protected-email decoding,
  shared-recruiter visibility, full descriptions, and evidence-preserving source
  references in the Jobs workspace.

## Hosted inventory and outreach parity

- [ ] `[FLOW-040]` Port durable local inventory reconciliation into hosted,
  resumable source runs with schedules, checkpoints, retries, freshness,
  source-specific completeness rules, and operator observability.
- [ ] Port the remaining local outreach behavior: message foundations,
  historical calibration, deterministic send gates, attempt/reply/follow-up
  state, and canonical operator actions. Retire duplicate Python paths only
  after hosted parity is proved.
- [ ] Make ranking, eligibility, campaigns, and manual Jobs review consume one
  authoritative matching implementation and current schema version.

## Product verification and launch readiness

- [ ] `[FLOW-001]` Validate onboarding with a fresh second account through resume
  import, reviewed profile, preferences, documents, Gmail OAuth, and a test-only
  first application.
- [ ] `[FLOW-010] [FLOW-021] [FLOW-030]` Validate shared workspace components at
  representative desktop and iPad-landscape viewports. Preserve the desktop
  two-pane model, compact controls, independent panes, and consistent message
  formatting.
- [ ] Add safe Maestro coverage for every implemented browser-visible flow and
  keep all external-send flows excluded from the default suite.
- [ ] Complete Google's production OAuth verification and security requirements
  before onboarding public users.
- [ ] Run the full migration and integration suites, `bun run check`, deployment
  dry-run, production migration, production deployment, smoke tests, screenshots,
  and verified `main` push.

## Operator commands

Run `bun run jobkit -- --help` for the canonical command surface. Durable
operations belong behind that entry point; one-off migration and evaluation
scripts do not stay in active product code.
