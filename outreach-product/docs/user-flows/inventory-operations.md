# Inventory operations

## FLOW-040: Refresh the global job inventory

**Actor:** Operator or scheduled system runner

**Entry:** The Automation inventory controls or a due source schedule.

This is an operational flow. Ordinary candidates consume its freshness and error state from Jobs and Countries rather than running every board adapter from the applicant navigation.

### Journey

1. The Worker writes one owned refresh request to D1. The minute cron writes the same request shape for a due schedule.
1. A paired Linux runner with the `operations` capability claims the request over outbound HTTPS and renews its lease while work is active.
1. The Go collector discovers stable source identifiers and checkpoints them in `collector_runs` and `collector_items`.
1. The collector hydrates listings sequentially under each board's request policy and retains literal source fields, application routes, contacts, and evidence.
1. The runner hashes the complete active local snapshot and publishes it to the Worker in resumable D1 batches. Publishing is sequential by default and supports explicitly bounded batch workers for operator-controlled backfills.
1. The Worker upserts source-owned job fields, preserves user-owned application state, and reconciles missing source rows only after every configured board completes a source-complete full run.
1. D1 records source counts, item outcomes, failures, leases, freshness, and completion for the Automation surface.

**Terminal state:** The inventory is reconciled, or the run is visibly partial with resumable checkpoints and source-specific errors.

The current implementation uses D1 as the durable request and lease queue. It has no Cloudflare Queue or Workflow binding. `bun run jobkit -- agent start` checks Codex tasks before inventory operations; operators may use `bun run jobkit -- agent start --operations-only` when inventory must run independently. The local runner must be active for a request to advance beyond `queued`.

### Candidate-visible result

- Jobs show when their source and route were last verified.
- Country summaries reflect new or closed opportunities.
- Stale or failed sources are visible without presenting old inventory as fresh.
- Saved, ignored, drafted, applied, and replied states remain unchanged.
