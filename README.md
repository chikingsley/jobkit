# JobKit

Private monorepo for the JobKit teaching-job platform and its supporting personal tooling. Keep the repository private: it contains personal documents, application history, credentials templates, and job-search data.

## Workspaces

```text
outreach-product/   Active Cloudflare-hosted JobKit web application and Worker
job-search/         Personal resumes, documents, outreach history, and local source inventory
tefl-course/        Standalone TEFL course-generation project
docs/               Repo-wide orientation and archived audits
```

The workspaces have separate dependency environments. Use Bun for the hosted product, Go for the JobKit-owned source collector under `outreach-product/collectors`, and each Python project's existing `uv` commands.

## Active application

```bash
cd outreach-product
bun install
bun run check
bun run dev
```

See [`outreach-product/README.md`](outreach-product/README.md) for the current hosted architecture, local setup, data flow, deployment commands, and secret requirements.

## Supporting tools

```bash
cd outreach-product/collectors
go run ./cmd/jobkit-collect jobs --db ../../job-search/job-data/jobs.sqlite
go run ./cmd/jobkit-collect refresh tefl --db ../../job-search/job-data/jobs.sqlite

cd ../../job-search
uv run build-resume --list
uv run build-resume --all

cd ../tefl-course
uv run tefl-course-check
```

The local scraped-job source of truth is `job-search/job-data/jobs.sqlite`. The Go collector writes source records there, the hosted application imports an immutable snapshot into D1, and per-user application state remains in D1.
