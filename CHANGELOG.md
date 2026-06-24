# Changelog

## 2026-06-23

- Fetched `origin/main`; local `main` was already current.
- Attempted a full `uv run jobs refresh`; the run was blocked by ANESL's long full-detail crawl
  and repeated remote read/handshake timeouts before the first DB write. `job-data/jobs.sqlite`
  remained unchanged from its 2026-06-12 snapshot.
- Added board-level CLI flushing and transient HTTP retry handling so future refresh attempts fail
  less silently.
- Added bounded-concurrency ANESL detail fetches with stderr progress; the next fix should be
  checkpointed/incremental ANESL refreshes so a failed detail crawl does not waste a whole run.
- Moved board and playbook docs under `docs/`.
- Archived the closed Actalent/Amazon interview-prep packet under `archive/interview-prep/actalent-amazon-pm/`.
- Added `docs/ingestion-research.md`, a source-backed research note covering Cloudflare D1/Cron,
  Queues, Workflows, Python concurrency, uv/Astral tooling, SQLite, and prior-art ingestion
  patterns. The decision is local checkpointed Python/SQLite first; Cloudflare publishing or hosted
  refresh later.

## Earlier Context

- `docs/job-boards.md` is the operational source for board coverage and refresh behavior.
- `docs/job-search-playbook.md` is the durable ESL job-search strategy source, distilled from Ben's 2019 paid consultation and later outreach evidence.
- `docs/jobkit-product-prd.md` and `docs/outreach-and-product-design.md` are product-planning notes, not required for routine job-search operations.
