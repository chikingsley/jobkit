# Ingestion Architecture

Status: draft  
Last updated: 2026-06-24

## Why This Exists

The ANESL refresh failure exposed a design problem, not just a slow website. Current ingestion lets
each board adapter build a full in-memory `list[JobPosting]` before the database is updated. For a
small board that is fine. For ANESL, it means thousands of remote detail-page requests can happen
before the first durable write. A timeout then discards all progress.

That is the wrong shape for the product described in
[`../../outreach-product/docs/jobkit-product-prd.md`](../../outreach-product/docs/jobkit-product-prd.md).
The product needs a visible, resumable job inventory, not a long opaque scraper command.

See [ingestion-research.md](ingestion-research.md) for the deeper source-backed research. The
current decision is to keep refresh execution local in Python/SQLite until the ingestion engine is
checkpointed. Cloudflare is a later publishing or hosted-execution target, not the immediate fix.

## Evidence

Local evidence:

- `../job-search/job-data/jobs.sqlite` has only 502 active ANESL rows, while the board notes describe a much larger
  historical database exposed through the WebForms pager.
- Failed full refreshes died inside ANESL detail-page reads before `db.refresh_postings(...)` ran,
  leaving `../job-search/job-data/jobs.sqlite` unchanged.
- The existing schema already has `scan_runs` and `scan_items`, but adapter fetch and DB write are
  still separated by one large in-memory posting list.

External prior art and platform guidance:

- Airbyte's incremental-sync docs define incremental sync as pulling only data changed since the
  previous sync, and call out the exact reason it matters: full syncs become too slow or expensive
  when there are many records or request limits. ANESL has no real timestamp cursor, but it does
  have stable listing IDs; those IDs can act as the presence cursor for discovery.
- Scrapy AutoThrottle treats politeness as a concurrency-and-delay problem, not as "one request at a
  time forever." Its design uses target concurrency, response latency, and hard limits. Jobkit
  should copy the principle, not necessarily the framework.
- Python's `ThreadPoolExecutor` is standard-library prior art for overlapping I/O-bound URL fetches.
  ANESL detail pages are independent once listing IDs are known, so bounded detail concurrency is
  justified.
- SQLite WAL mode supports readers and writers proceeding concurrently. Jobkit already enables WAL,
  so small committed batches are a better fit than one giant transaction after a full crawl.
- The product PRD already points toward Cloudflare Workers, D1, Cron, and Queues. The research
  decision is narrower: D1 can hold this inventory, but a plain Cron Worker is not a safe home for
  the current full refresh. If refresh execution ever moves to Cloudflare, it should map to Cron as
  a trigger plus Queues or Workflows as durable work units. The local CLI should evolve toward that
  same phase-based model first.

## Principles

1. Discovery and hydration are different jobs.
   Discovery answers "which job IDs are present now?" Hydration answers "what are the latest details
   for this job?" Mixing them makes closure unsafe and refreshes slow.

2. Incremental is the default; full reconciliation is explicit.
   For ANESL, routine refresh should discover IDs and hydrate only new or stale rows. Full detail
   rehydration should be a deliberate maintenance command.

3. Every expensive external unit gets checkpointed.
   A detail page fetch should be committed soon after it succeeds. A failure after 3,000 successful
   detail pages should not throw away 3,000 pages of work.

4. Completeness is proven per phase.
   A board should only close missing rows after discovery succeeds for a complete source. Hydration
   failures should not close rows.

5. Concurrency is bounded and board-specific.
   Some board steps are inherently sequential, such as ANESL WebForms pagination with carried
   `__VIEWSTATE`. Independent detail pages can use a small worker pool. SeriousTeachers and logged-in
   flows may need stricter limits.

6. The CLI should expose product-shaped state.
   Users should see active refresh runs, per-board phase, seen IDs, hydrated rows, failures, retries,
   and last successful completion. The future UI needs the same facts.

7. Application state is never overwritten by scrape state.
   Existing `ignored` and `applied` preservation is correct. The next model should extend this with
   event history, not regress to destructive refresh behavior.

## Target Local Design

### Adapter Protocol

Each board should implement capabilities instead of only `fetch_all()`.

```python
class BoardAdapter(Protocol):
    name: str
    complete_discovery: bool

    def discover(self) -> DiscoveryResult:
        """Return stable job IDs currently visible on the board."""

    def hydrate(self, job_id: str) -> JobPosting:
        """Return detail data for one job ID."""
```

`DiscoveryResult` should include:

- `job_ids`
- `complete`
- `source_metadata`
- `errors`

### Database Flow

1. Start a `scan_run` with board and phase metadata.
2. Run discovery.
3. Commit `scan_items` and update `last_checked_at` / `last_present_at` from discovered IDs.
4. If discovery is complete, close missing active rows for that board.
5. Select hydration candidates:
   - IDs not in `jobs`
   - rows with stale `last_hydrated_at`
   - rows explicitly requested with `--rehydrate`
6. Hydrate in small batches with retry counts.
7. Commit each batch.
8. Finish the scan run with counts and errors.

This means the DB can truthfully say "ANESL discovery completed but 23 details failed and are queued
for retry." That is more useful than "the command died and nothing changed."

### Schema Changes

Keep the current tables, but add the missing phase-level fields.

```sql
ALTER TABLE jobs ADD COLUMN last_hydrated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN detail_error TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN detail_retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scan_runs ADD COLUMN board TEXT NOT NULL DEFAULT '';
ALTER TABLE scan_runs ADD COLUMN phase TEXT NOT NULL DEFAULT '';
ALTER TABLE scan_runs ADD COLUMN error_json TEXT NOT NULL DEFAULT '[]';
```

Longer term, add a dedicated table if failures need richer history:

```sql
CREATE TABLE job_fetch_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    job_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    run_id INTEGER REFERENCES scan_runs(id)
);
```

## ANESL-Specific Plan

ANESL should change from "full detail crawl before DB write" to:

1. `discover()`
   - Walk the WebForms pager.
   - Collect IDs.
   - Commit presence immediately.

2. `hydrate(job_id)`
   - Fetch one detail page.
   - Parse the label/value table.
   - Commit the row.

3. Routine command
   - `uv run jobs refresh anesl` means discover + hydrate new/stale rows.

4. Maintenance command
   - `uv run jobs refresh anesl --rehydrate-all` means intentionally revisit every detail page.

5. Politeness controls
   - Keep `DETAIL_WORKERS` small.
   - Add board-level config for worker count, retries, and timeout.
   - Slow down or pause on repeated timeout / non-200 patterns.

## What Not To Do

- Do not make every board use the same crawl strategy. Board capabilities differ too much.
- Do not close rows when discovery did not complete.
- Do not tie product refresh state to stdout parsing.
- Do not use concurrency as a substitute for checkpoints.
- Do not move complicated authenticated workflows to Cloudflare Workers until they are safe and
  observable locally.

## Implementation Order

1. Add discovery/hydration protocol while keeping current board modules.
2. Convert ANESL first because it is the clearest failure mode.
3. Add DB checkpoint helpers for discovered IDs and hydrated batches.
4. Add CLI status output from DB state, not just prints.
5. Convert TEFL/Ajarn/ESL Cafe where straightforward.
6. Treat SeriousTeachers separately because login-gated apply resolution and country×subject crawling
   have different risk and rate limits.
7. Add local scheduling only after refreshes are resumable.
8. Publish static/SQLite artifacts or add D1 sync only after local ingestion semantics are correct.

## Decision

The bounded ANESL detail worker pool is a tactical improvement, but it is not the architecture. The
architecture is resumable, phase-based ingestion with durable checkpointing. That is the standard
shape that matches both data-engineering prior art and the product roadmap.
