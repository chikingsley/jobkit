# JobKit

Private monorepo for the JobKit teaching-job platform and its supporting personal tooling. Keep the
repository private: it contains personal documents, application history, credentials templates, and
job-search data.

## Workspaces

```text
outreach-product/   Active Cloudflare-hosted JobKit web application and Worker
job-search/         Personal resumes, documents, outreach history, and local source inventory
tefl-job-board/     TEFL/ESL source-ingestion CLI
tefl-course/        Standalone TEFL course-generation project
docs/               Repo-wide orientation and archived audits
```

The workspaces have separate dependency environments. Use Bun in `outreach-product` and the
workspace's existing `uv` commands in each Python project.

## Active application

```bash
cd outreach-product
bun install
bun run check
bun run dev
```

See [`outreach-product/README.md`](outreach-product/README.md) for the current hosted architecture,
local setup, data flow, deployment commands, and secret requirements.

## Supporting tools

```bash
cd tefl-job-board
uv run jobs stats
uv run jobs refresh tefl ajarn

cd ../job-search
uv run build-resume --list
uv run build-resume --all

cd ../tefl-course
uv run tefl-course-check
```

The local scraped-job source of truth is `job-search/job-data/jobs.sqlite`. The hosted application
imports normalized inventory from that database into D1; per-user application state remains in D1.
