# TEFL Job Board

Standalone `uv` project for pulling TEFL/ESL job boards into the local SQLite inventory.

## Commands

```bash
uv run jobs stats
uv run jobs countries
uv run jobs refresh tefl ajarn
uv run jobs refresh
uv run jobs refresh --latest seriousteachers anesl
```

The database is intentionally outside this project at `../job-search/job-data/jobs.sqlite`, because
it is part of the user's personal application workspace. Refreshes upsert by `(board, job_id)` and
preserve manual statuses such as `applied` and `ignored`.

## Layout

```text
src/jobkit/jobs/     board adapters, enrichment, SQLite storage, and CLI
docs/                board notes, board coverage, and ingestion architecture
```

Implemented adapters include ANESL, SeriousTeachers, ESL Cafe modern, Ajarn, and TEFL.com.
Use `--latest` for a quick newest-listings pass that preserves unseen inventory. Omit it for a
complete board crawl that reconciles and closes missing listings.
