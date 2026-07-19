# JobKit roadmap

This is the canonical list of unfinished product work. Completed implementation
belongs in Git history, not in this file.

## Evaluation

- [ ] Record blinded human preference votes in Test Lab before promoting any
  provider for user-facing research or writing. Automated scores cannot stand
  in for this user decision.

## Product verification and launch readiness

- [ ] `[FLOW-001]` Validate onboarding with a fresh second account through resume
  import, reviewed profile, preferences, documents, Gmail OAuth, and a test-only
  first application.
- [ ] Complete Google's production OAuth verification and security requirements
  before onboarding public users.

## Operator commands

Run `bun run jobkit -- --help` for the canonical command surface. Durable
operations belong behind that entry point; one-off migration and evaluation
scripts do not stay in active product code.
