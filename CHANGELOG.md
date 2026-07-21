# Changelog

## 2026-07-20

- Completed operator adjudication of all 23 real-listing classification disagreements and froze the 200-label corpus with source hashes and label provenance.
- Grouped recruiter reposts and shared listing templates before creating the 174-training and 26-held-out split, then exported the frozen snapshot to Parquet.
- Recorded a 14/26 zero-shot Jina v3 held-out baseline; private classifier training remains blocked by reproducible provider HTTP 500 responses from `/v1/train`.
- Replaced the Python TEFL/ESL board project with the JobKit-owned Go collector under `outreach-product/collectors`.
- Ported Ajarn, ANESL, ESL Cafe, SeriousTeachers, and TEFL.com into `internal/boards`, with a shared resumable SQLite inventory boundary under `internal/inventory`.
- Removed the Python registry, crawler, Superwhisper client, and regex semantic-enrichment path after live anonymous reads succeeded for all five sources.
- Changed hosted inventory operations to invoke `jobkit-collect` and kept compensation, organization type, subjects, and qualifications behind evidence-backed Codex analysis.
- Completed source-wide Go refreshes with zero unresolved details: 150 Ajarn, 4,005 ANESL, 338 ESL Cafe, 1,759 SeriousTeachers, and 158 TEFL records.
- Published the exact 6,410-active-record snapshot to D1 as inventory run `369fe1c3-6223-45b8-81ee-8dc1a455f8a6`; all 65 batches completed, no item failed, and reconciliation closed 307 previously hosted records.
- Made retryable source responses stop hydration immediately while preserving resumable state, added bounded concurrent D1 batch publishing, and removed the retired `scan_runs` and `scan_items` tables.

## 2026-07-05

- Split the repo into standalone workstreams: `tefl-job-board/`, `job-search/`, `outreach-product/`, and the existing `tefl-course/`.
- Moved the root `uv` project into subprojects so the repo root is now an index rather than an active Python environment.
- Kept `job-search/job-data/jobs.sqlite` as the durable local job inventory used by the job-board project.

## 2026-06-23

- Fetched `origin/main`; local `main` was already current.
- Attempted a full `uv run jobs refresh`; the run was blocked by ANESL's long full-detail crawl and repeated remote read/handshake timeouts before the first DB write. `job-search/job-data/jobs.sqlite` remained unchanged from its 2026-06-12 snapshot.
- Added board-level CLI flushing and transient HTTP retry handling so future refresh attempts fail less silently.
- Added bounded-concurrency ANESL detail fetches with stderr progress; the next fix should be checkpointed/incremental ANESL refreshes so a failed detail crawl does not waste a whole run.
- Moved board and playbook docs under `docs/`.
- Archived the closed Actalent/Amazon interview-prep packet under `job-search/archive/interview-prep/actalent-amazon-pm/`.
- Added `docs/ingestion-research.md`, a source-backed research note covering Cloudflare D1/Cron, Queues, Workflows, Python concurrency, uv/Astral tooling, SQLite, and prior-art ingestion patterns. The decision is local checkpointed Python/SQLite first; Cloudflare publishing or hosted refresh later.

## Earlier Context

- `tefl-job-board/docs/job-boards.md` is the operational source for board coverage and refresh behavior.
- `job-search/docs/job-search-playbook.md` is the durable ESL job-search strategy source, distilled from Ben's 2019 paid consultation and later outreach evidence.
- `outreach-product/docs/jobkit-product-prd.md` and `outreach-product/docs/outreach-and-product-design.md` are product-planning notes, not required for routine job-search operations.
