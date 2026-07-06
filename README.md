# jobkit

Private monorepo for Chibuzor Ejimofor's job-search work. The root is only an index; each active
Python tool lives in its own folder with its own `uv` project and lockfile.

Keep this repository private. It contains personal documents, job-search records, and outreach
history.

## Layout

```text
tefl-job-board/     TEFL/ESL board ingestion CLI (`uv run jobs ...`)
job-search/         resumes, job documents, outreach drafts, templates, and archive
outreach-product/   product planning notes for a possible hosted outreach/jobkit app
tefl-course/        standalone TEFL course-generation project
docs/               repo-wide orientation only
CHANGELOG.md        cross-workspace history
```

## Common Commands

```bash
cd job-search
uv run build-resume --list
uv run build-resume --all
uv run outreach sync

cd ../tefl-job-board
uv run jobs stats
uv run jobs refresh tefl ajarn

cd ../tefl-course
uv run tefl-course-check
uv run tefl-course-assessments assemble
```

The durable scraped-job database lives at `job-search/job-data/jobs.sqlite`. The job-board project
writes to that file; the personal job-search workspace owns it.
