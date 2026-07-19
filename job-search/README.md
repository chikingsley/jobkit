# Job Search Workspace

Personal job-search source workspace: resumes, generated PDFs, job documents,
sent-outreach evidence, and closed lead archives.

## Layout

```text
src/jobkit/          resume builder
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
```

Generated resume PDFs go to `resumes/pdfs/`. Hosted application email, reply sync, explicit
follow-up scheduling, and Codex drafting run through `../outreach-product`. Historical
correspondence and the evidence-backed playbook remain here as source material; this package no
longer contains a second outreach runtime.
