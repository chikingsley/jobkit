# Ingestion Research Notes

Status: research-backed decision  
Last updated: 2026-06-24

This note captures the deeper research behind the ingestion architecture. The short version: keep
jobkit's crawler as a local Python/SQLite system for now, fix the engine shape, then publish or
replicate the result. Cloudflare is interesting, but only after the local ingestion model is already
phase-based and resumable.

## Decision

Use the local packaged `uv` Python project and `../job-search/job-data/jobs.sqlite` as the source
of truth.
Refactor ingestion into discovery, hydration, and checkpointed database writes before changing the
deployment platform.

Cloudflare should be considered in this order:

1. Publish a read artifact first: static UI, exported SQLite, JSON, or search index.
2. Add D1 as a read/query replica if a hosted product needs SQL.
3. Move refresh execution to Cloudflare only if it is rebuilt as Cron plus Queues or Workflows, with
   idempotent D1 writes and dead-letter handling.

Do not port the current full refresh command directly into a scheduled Worker. That would move the
bug to a tighter runtime.

## Local Evidence

- `../job-search/job-data/jobs.sqlite` is about 20 MB, so storage size is not the hard problem.
- Active inventory at research time: `ajarn=159`, `anesl=502`, `eslcafe-modern=439`,
  `seriousteachers=1498`, `tefl=62`.
- The DB is in SQLite WAL mode, but `PRAGMA busy_timeout` currently returns `0`; a checkpointed
  writer should set a nonzero timeout.
- Current `jobs refresh` calls `policy.fetch()` before any DB write, then `db.refresh_postings(...)`
  commits after the whole posting list is enriched and upserted.
- ANESL now uses a small `ThreadPoolExecutor` for detail pages, but it still builds the detail list
  before DB persistence. That is a speed patch, not a resumability fix.
- The project is `requires-python = ">=3.12,<3.14"` and already depends on `httpx`.
- Local uv is `0.11.21`; `uv self update --dry-run` reports `0.11.24` available. `uv lock --check`
  passes. `uv audit --locked` is available and found no known vulnerabilities, with uv warning that
  `audit` is experimental.

## Option Matrix

| Option | Fit | Decision |
|---|---|---|
| Local Python CLI + SQLite checkpointing | Best match for current code and data privacy | Do first |
| Local scheduled refresh via `systemd --user` timer | Better local observability than plain cron | Do after checkpointing |
| Static/SQLite artifact publishing | Smallest cloud step; keeps Python scrapers local | Do before D1 execution |
| D1 read/query replica | Plausible because data is small and relational | Later |
| Cron Worker + D1 only | Too fragile for full refresh; 15-minute scheduled window and no work queue | Avoid |
| Cron producer + Queues + D1 | Good hosted design if discovery creates hydration messages | Later |
| Workflows + D1, optionally Queues | Best Cloudflare-native long-running design | Later, if hosted refresh matters |
| GitHub Actions scheduled artifact | Possible, but private data and schedule reliability are concerns | Maybe, not first |
| Hyperdrive | Meant for existing Postgres/MySQL, not local SQLite or D1 | Not relevant now |

## Cloudflare Findings

### D1

D1 is not the blocker. Cloudflare documents D1 as SQLite-compatible SQL with Worker and HTTP API
access, a 500 MB free database limit, a 10 GB paid database limit, 100 columns per table, 2 MB max
row/string/blob, and unlimited rows within storage limits. Jobkit's current 20 MB SQLite database is
comfortably below that.

D1 still has execution constraints that shape design. Each database processes queries one at a time,
excess concurrent requests can queue and overload, and large migrations or writes should be batched.
D1 `batch()` is useful because it sends multiple prepared statements in one call and Cloudflare says
batched statements are transactions.

Implication for jobkit: D1 is fine for queryable state or a replica. It is not a reason to skip
checkpointing or batch design.

Sources: [D1 overview](https://developers.cloudflare.com/d1/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

### Workers Cron

Cron Triggers are a good trigger, not a whole ingestion engine. Cloudflare explicitly positions Cron
Triggers for periodic jobs and calling third-party APIs, and the scheduled handler exists for
Python/TypeScript/JavaScript. But scheduled Workers have a 15-minute wall-clock limit, Workers have
128 MB memory per isolate, and simultaneous outgoing connections are capped.

Implication for jobkit: a Worker that tries to crawl ANESL plus SeriousTeachers directly is the
wrong shape. Cron should enqueue or start durable work, not do the full scrape.

Sources: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Python Workers

Python Workers are real, but they are not normal local CPython. They run on Pyodide inside a V8
isolate; Python Workers are still beta; Python worker package support depends on pure Python,
PyEmscripten, or Pyodide packages; and Cloudflare's Python standard-library page says `threading`
and `multiprocessing` can be imported but are not functional in the Worker runtime.

Implication for jobkit: the current `ThreadPoolExecutor` patch is not portable to Python Workers.
Moving execution to Cloudflare would mean an async Python/Pyodide rewrite or a TypeScript Worker,
not a straight deploy.

Sources: [Python Workers](https://developers.cloudflare.com/workers/languages/python/), [How Python Workers work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/), [Python Worker packages](https://developers.cloudflare.com/workers/languages/python/packages/), [Python Worker standard library](https://developers.cloudflare.com/workers/languages/python/stdlib/).

### Queues

Queues fit the eventual hosted ingestion model. Cloudflare Queues support batching, retries, delays,
dead-letter queues, 128 KB messages, 100-message batches, and 15-minute consumer invocations.

For jobkit, queue messages should be small units like:

```json
{"board":"anesl","phase":"hydrate","job_id":"12345","run_id":42}
```

They should not carry full raw HTML. Raw snapshots belong in R2 or a local archive if we decide to
store them.

Sources: [Queues overview](https://developers.cloudflare.com/queues/), [Queues batching, retries, delays](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/).

### Workflows

Workflows are the better Cloudflare-native fit for a hosted refresh. A Workflow is made of durable,
individually retryable steps that can persist state; paid limits allow many more steps than the free
plan, and wall-clock time per step is unlimited while CPU limits still apply.

The important rule is not "use Workflows." The important rule is "make the steps granular and
idempotent." That is exactly the local target: discover IDs, commit presence, hydrate batches, commit
rows, record failures, retry failed units.

Sources: [Workflows overview](https://developers.cloudflare.com/workflows/), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

### R2 And Hyperdrive

R2 is useful for exported SQLite files, raw HTML snapshots, static artifacts, and long-retention
backups. Hyperdrive is not useful unless jobkit moves to an external Postgres or MySQL database,
because Hyperdrive accelerates access to existing regional databases.

Sources: [R2 limits](https://developers.cloudflare.com/r2/platform/limits/), [Hyperdrive overview](https://developers.cloudflare.com/hyperdrive/).

## Python And uv Findings

### ThreadPoolExecutor

Use `ThreadPoolExecutor` first for the existing adapters. The workload is mostly network I/O plus
light parsing, and the standard library executor API fits that without rewriting the whole codebase.

Do not submit thousands of futures blindly. With the current Python range, implement a bounded
in-flight loop if needed. Python 3.14 adds `Executor.map(..., buffersize=...)`, but the project
currently excludes Python 3.14, so that is future cleanup, not current code.

Avoid `ProcessPoolExecutor` for scraping. It adds pickling/import constraints and process overhead
without solving the actual remote I/O bottleneck.

Sources: [Python concurrent.futures](https://docs.python.org/3/library/concurrent.futures.html), [Python 3.14 changes](https://docs.python.org/3/whatsnew/3.14.html).

### Async

Do not rewrite every adapter to async immediately. If async becomes worth it, use `httpx.AsyncClient`
because `httpx` is already a dependency. Use one shared async client, explicit connection limits,
explicit connect/read/write/pool timeouts, `asyncio.TaskGroup` for structured cancellation, and
`asyncio.timeout` around bounded phases.

Sources: [HTTPX async support](https://www.python-httpx.org/async/), [HTTPX resource limits](https://www.python-httpx.org/advanced/resource-limits/), [HTTPX timeouts](https://www.python-httpx.org/advanced/timeouts/), [asyncio tasks](https://docs.python.org/3/library/asyncio-task.html).

### SQLite

Keep SQLite and WAL. SQLite documents that WAL lets readers and writers proceed concurrently, and
jobkit already uses WAL. The implementation should add a busy timeout, use one writer connection,
commit small batches, and keep `INSERT ... ON CONFLICT` upserts as the row-level idempotency tool.

The next product feature after resumability should probably be search. SQLite FTS5 can support fast
local search over title/company/location/description without adding a search service.

Sources: [SQLite WAL](https://sqlite.org/wal.html), [SQLite isolation](https://sqlite.org/isolation.html), [Python sqlite3 transaction control](https://docs.python.org/3/library/sqlite3.html), [SQLite UPSERT](https://sqlite.org/lang_upsert.html), [SQLite FTS5](https://sqlite.org/fts5.html).

### uv And Astral

Keep jobkit as a normal packaged `uv` project with console scripts in `[project.scripts]`.
Scheduled commands should run as `uv run --locked jobs ...` from
`/home/simon/github/jobkit/tefl-job-board`.
Use `uv lock --check` and `uv audit --locked` in checks. Use `uv sync --locked` for reproducible
setup. Use `uvx` only for isolated external tools, not for commands that import the project.

Sources: [uv overview](https://docs.astral.sh/uv/), [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/), [uv Python versions](https://docs.astral.sh/uv/concepts/python-versions/), [uv scripts](https://docs.astral.sh/uv/guides/scripts/), [uv tools](https://docs.astral.sh/uv/guides/tools/), [ty](https://docs.astral.sh/ty/), [Ruff](https://docs.astral.sh/ruff/).

## Prior Art To Steal

Do not import Airbyte, Scrapy, Crawlee, Prefect, Dagster, or Datasette wholesale. Steal the proven
invariants.

1. Airbyte: every source stream owns checkpoint state. Jobkit should store per-board progress and
   make each board independently restartable. Sources: [Airbyte state/checkpointing](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol), [Airbyte incremental sync](https://docs.airbyte.com/platform/connector-development/connector-builder-ui/incremental-sync).
2. Crawlee: separate the request queue/frontier from extracted result storage. Jobkit's version is a
   `discovered_job_ids` or `job_fetch_attempts` table plus `jobs` as the result inventory. Source:
   [Crawlee architecture](https://crawlee.dev/python/docs/guides/architecture-overview).
3. Scrapy: pausing and resuming crawls works by persisting scheduled requests, visited requests, and
   spider state. Jobkit should persist the hydration frontier in SQLite, not stdout. Source:
   [Scrapy jobs](https://docs.scrapy.org/en/latest/topics/jobs.html).
4. Heritrix: checkpointing means enough stable state to resume from the prior crawl state. Jobkit
   should treat every expensive external fetch as a checkpointable unit. Source:
   [Heritrix glossary](https://heritrix.readthedocs.io/en/latest/glossary.html).
5. Scrapy/Crawlee: politeness is not "one request forever"; it is bounded concurrency plus delay,
   latency/error feedback, and per-target configuration. Sources:
   [Scrapy AutoThrottle](https://docs.scrapy.org/en/latest/topics/autothrottle.html), [Crawlee scaling](https://crawlee.dev/python/docs/guides/scaling-crawlers).
6. Prefect: task state, retries, cache, and concurrency limits are first-class run facts. Jobkit does
   not need Prefect, but it needs run/failure state visible from the DB. Sources:
   [Prefect states](https://docs.prefect.io/v3/concepts/states), [Prefect task runners](https://docs.prefect.io/v3/concepts/task-runners), [Prefect tag concurrency](https://docs.prefect.io/v3/concepts/tag-based-concurrency-limits).
7. Dagster: partitions/backfills turn large work into rerunnable subsets. Jobkit partitions are
   board-specific: ANESL page ranges or ID batches; SeriousTeachers country x subject slices.
   Source: [Dagster partitioning](https://docs.dagster.io/guides/build/partitions-and-backfills/partitioning-assets).
8. Datasette/sqlite-utils: SQLite can be both the durable store and the publishable artifact. Jobkit
   can stay simple by publishing its SQLite-derived data before adding a hosted write path. Sources:
   [Datasette publishing](https://datasette.io/for/publishing-data), [sqlite-utils](https://sqlite-utils.datasette.io/).
9. Git scraping/GitHub Actions: scheduled scraping can publish data artifacts, but the scheduler is
   not the source of truth. Jobkit's source of truth should be the DB run tables. Sources:
   [GitHub schedule syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule), [Simon Willison on git scraping](https://simonwillison.net/tags/git-scraping/).

## Implementation Consequences

The next implementation pass should do this locally:

1. Add schema fields/tables for hydration status, retry counts, detail errors, and run phase.
2. Add DB functions for discovery commit, hydration candidate selection, batch upsert, failure
   recording, and close-missing only after complete discovery.
3. Convert ANESL first: sequential WebForms discovery, immediate presence commit, bounded detail
   hydration, small DB commits.
4. Add CLI state commands: `jobs runs`, `jobs status --json`, `jobs failures --board anesl`,
   `jobs retry anesl`, `jobs refresh anesl --rehydrate-all`.
5. Add connection `busy_timeout` and keep one writer connection.
6. Add a local `systemd --user` timer only after refreshes are resumable.
7. Publish an artifact or D1 read replica only after local semantics are correct.

## What Not To Do

- Do not run routine `refresh all` as the main workflow.
- Do not close rows from partial discovery.
- Do not use concurrency to hide missing checkpoints.
- Do not share SQLite connections across worker threads.
- Do not port scraper execution to Cloudflare before local run state is correct.
- Do not add APScheduler unless jobkit becomes a long-running daemon.
- Do not use Hyperdrive unless there is an external Postgres/MySQL database to accelerate.
