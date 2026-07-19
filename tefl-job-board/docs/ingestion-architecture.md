# Ingestion Architecture

Status: implemented local ingestion contract
Last updated: 2026-07-18

## Purpose

The inventory must survive long board crawls, prove when a source was fully traversed, and expose
its state without parsing terminal output. The local Python/SQLite engine therefore uses explicit
discovery and hydration phases. The hosted outreach product consumes published inventory; it does
not treat an opaque, all-in-memory scraper command as authoritative.

The source and platform research behind this decision remains in
[ingestion-research.md](ingestion-research.md). Product integration is described in the outreach
product documentation.

## Implemented Contract

Each registered board provides:

1. `discover_latest()` for a non-destructive newest-listing sample.
2. `discover_full()` for a source-complete traversal with explicit completeness evidence.
3. `hydrate(discovered_job)` for one detail page.
4. Optional run-scoped hydration setup for authenticated or stateful sources.

Both discovery methods return a `DiscoveryResult` containing stable items, an explicit `complete`
flag, and source evidence. A full refresh refuses reconciliation unless `complete` is true.

Completeness comes from the source shape rather than a configured job-count threshold:

- ANESL validates every WebForms page against its reported record count, page count, and current
  page, then verifies that the number of unique IDs equals the reported total.
- ESL Cafe validates API `page`, `lastPage`, and `total` metadata for each of its three boards and
  verifies each board's stable-ID count.
- SeriousTeachers traverses the finite country-by-subject matrix exposed by its homepage. Explicit
  404/410 pages are empty; transport failures abort the run.
- TEFL.com follows pagination until the source returns no new IDs.
- Ajarn verifies the first live listing page and follows its repeated-page behavior to exhaustion.

If a parser or pagination contract breaks, the run stays in discovery with an error. Existing jobs
remain active.

## Durable Database Flow

`crawl_runs` stores one board/mode execution, the source-completeness flag, and the source evidence.
`crawl_items` stores the complete discovered ID ledger plus per-ID attempts, status, outcome, and
errors.

The refresh sequence is:

1. Reuse an unfinished run for the same board and mode, unless `--restart` explicitly cancels it.
2. Run discovery and validate its completeness contract.
3. Commit the whole discovered-ID ledger.
4. Mark discovered existing rows present. Close absent rows only for a proven-complete full run.
5. Hydrate every pending or failed ID.
6. Commit each success or failure immediately.
7. Mark the crawl and its linked `scan_runs` record complete only when no failed details remain.

This makes a detail failure resumable. A second invocation retries failed IDs and does not refetch
already hydrated IDs from the same crawl.

Run state is inspectable directly from SQLite:

```bash
uv run jobs runs
uv run jobs runs --board anesl
```

The output includes board, mode, status, discovered, hydrated, failed, attempts, closed rows, audit
timestamps, and the current error. There is no display-only progress file or stdout-derived state.

## Board-Specific Execution

Concurrency and session behavior belong to the board policy:

- ANESL listing discovery is sequential because WebForms carries `__VIEWSTATE`; its independent
  detail pages use a small worker pool.
- SeriousTeachers hydrates serially and reuses one optional authenticated client across the run.
  A failed login disables apply-link enrichment without discarding public job details. Individual
  gated-route failures retain the original route and remain visible in diagnostics.
- Other boards hydrate serially with their configured polite delay.

Concurrency is an I/O strategy, not a substitute for durability.

## Safety Invariants

- A latest refresh never closes unseen inventory.
- A full refresh closes unseen inventory only after source completeness is proven.
- Hydration failure never causes an unrelated job to close.
- `applied` and `ignored` product states survive scrape reconciliation.
- `BaseException` classes such as interrupts escape; adapter exceptions are recorded per item.
- Restarting unfinished work is explicit through `--restart`.
- Production full discovery does not depend on arbitrary page or listing caps.

## Remaining Boundary

The expensive detail phase is fully resumable. Discovery itself is persisted after its complete
source traversal, not after every listing page. This is acceptable for the current local engine
because discovery requests are the smaller phase and closure requires an all-or-nothing proof. If
listing-page traversal becomes the dominant failure mode, add board-specific page cursors to
`crawl_runs` without weakening the completeness gate.

Hosted scheduling should preserve these semantics. A future Cloudflare implementation should use a
scheduled trigger plus durable Queue or Workflow units, D1 claims, and idempotent publication. A
plain scheduled Worker that performs an entire crawl inside one request is not equivalent.
