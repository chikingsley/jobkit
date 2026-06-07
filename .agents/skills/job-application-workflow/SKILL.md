---
name: job-application-workflow
description: Use when working on Chibuzor Ejimofor's job search, resumes, recruiter emails, references, application tracking, job descriptions, or tailored application packets in the jobkit workspace.
---

# Job Application Workflow

Use `~/github/jobkit` as the canonical workspace.

`job documents/` holds identity/credential PDFs (passport, diplomas, FBI checks, TEFL cert) for applications that require them.

## First Checks

1. Read `README.md`.
2. Inspect `application-tracker.csv` (root) and the relevant `leads/<slug>/application.md` record.
3. Read the matching `leads/<slug>/job-description.md` before editing resumes or drafts.
4. Verify the active Gmail account before sending or drafting from Gmail tools.
   Use `gws-profile <chibuzor|cheez2012> ...` to pick the account; confirm with
   `gws-profile <name> auth status` before any send.

## Resume Work

- Source resumes are markdown in `resumes/` (`master-resume.md`, `project-management-resume.md`, `teaching-resume.md`).
- Build PDFs with `uv run build-resume <pm|master|teaching|--all>` (or `just pm` / `just all`); outputs land in `resume-pdfs/`.
- The build code is the `jobkit` package in `src/jobkit/` (template + CSS in `src/jobkit/assets/`).
- The recruiter-facing file is named `Chibuzor Ejimofor - Resume.pdf` — that is only the send-time rename of the chosen variant, not a stored file.
- Prefer tailoring the smallest relevant section rather than rewriting the whole resume.
- Preserve quantified achievements unless the job description clearly calls for a different framing.

## Application Records

For each lead, add a row to `application-tracker.csv` (root) and create `leads/<lead-slug>/`
with:

- `application.md` — status, next action, role and company, source, resume variant, fit notes, follow-up notes
- `job-description.md` — the raw recruiter/job text

When a lead dies or closes: set its CSV `status` (e.g. `closed-dead`), clear `next_action`,
move the whole `leads/<lead-slug>/` folder into `archive/leads/<lead-slug>/`, and update the
CSV `job_file` to that path. Superseded resume files go in `archive/old-resumes/`.

## Email Drafts

Use `templates/email-templates.md` as the starting point. Keep messages concise and factual. Do not invent reference details, dates, compensation, or availability.

## Privacy

This repo contains personal information. Treat it as private and avoid adding unrelated personal records, secrets, credentials, or identity documents.
