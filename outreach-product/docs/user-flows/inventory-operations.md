# Inventory operations

## FLOW-040: Refresh the global job inventory

**Actor:** Operator or scheduled system runner

**Entry:** A scheduled refresh, an operator command, or a future admin surface.

This is an operational flow. Ordinary candidates consume its freshness and
error state from Jobs and Countries rather than running every board adapter from
the applicant navigation.

### Journey

1. Start a refresh run with a durable run ID and source scope.
2. Discover source identifiers and checkpoint them.
3. Hydrate listings in bounded, restartable batches.
4. Normalize routes, compensation, contacts, and source evidence.
5. Upsert jobs while preserving user-owned application state.
6. Reconcile missing source rows according to each board's completeness policy.
7. Publish source counts, changes, failures, retries, freshness, and completion.

**Terminal state:** The inventory is reconciled, or the run is visibly partial
with resumable checkpoints and source-specific errors.

### Candidate-visible result

- Jobs show when their source and route were last verified.
- Country summaries reflect new or closed opportunities.
- Stale or failed sources are visible without presenting old inventory as fresh.
- Saved, ignored, drafted, applied, and replied states remain unchanged.
