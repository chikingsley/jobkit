# Job Search Workspace

Personal job-application workspace: resumes, generated PDFs, job documents, outreach templates,
sent-outreach evidence, and closed lead archives.

## Layout

```text
src/jobkit/          resume builder, outreach CLI, and local LLM client
resumes/             editable resume markdown plus generated PDFs
job-data/            jobs.sqlite, credential PDFs, and recovered outreach corpus
templates/           reusable email and reference templates
archive/             closed leads, interview prep, and old resumes
docs/                job-search playbook and outreach rules
```

## Commands

```bash
uv run build-resume --list
uv run build-resume --all
uv run build-resume teaching

uv run outreach sync
uv run outreach follow-ups
uv run outreach jobs.csv --dry-run
```

Generated resume PDFs go to `resumes/pdfs/`. Outreach commands are draft-first; this package has
no send-mail path.
