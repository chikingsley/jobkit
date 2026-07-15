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

Generated resume PDFs go to `resumes/pdfs/`. The legacy `outreach` CLI remains draft-only.
`jobkit-gmail send` is the separate, explicit path for sending a hosted, already-recorded draft.

# Personal Gmail bridge

`jobkit-gmail` connects approved email attempts from hosted JobKit to the already authenticated
personal Gmail profile. It uses the hosted, snapshotted MIME message and attachments unchanged.
Credentials are never stored in this repository: set `JOBKIT_EMAIL` and `JOBKIT_PASSWORD`, or let
the command prompt for them. `JOBKIT_URL` and `JOBKIT_GWS_PROFILE` override the production-safe
defaults when needed.

```bash
# Inspect attention states: approved, drafted, sending, uncertain, and failed.
uv run --locked jobkit-gmail list

# Inspect one state or every state, including completed sends.
uv run --locked jobkit-gmail list --status uncertain
uv run --locked jobkit-gmail list --status all

# Queue a hosted application route after approving its generated draft.
uv run --locked jobkit-gmail queue JOB_ID --draft-id DRAFT_ID --route-id ROUTE_ID

# Claim one approved attempt and create a Gmail draft. This command cannot send mail.
uv run --locked jobkit-gmail draft ATTEMPT_ID

# Explicitly send that already-recorded Gmail draft, verify its SENT label, and record its IDs.
uv run --locked jobkit-gmail send ATTEMPT_ID

# Run the executor that handles only explicit Send clicks from the JobKit UI.
uv run --locked jobkit-gmail watch
```

Before invoking Gmail send, the bridge atomically moves the attempt from `drafted` to `sending`.
Every HTTP, JSON, Gmail CLI, and SENT-verification error stops the operation. Any failure after
Gmail send was invoked moves the attempt to `uncertain`, which must be reconciled before another
send can be attempted; the CLI will not blindly resend. Every `gws` subprocess is bounded to 90
seconds so a hung Google CLI cannot hang the executor indefinitely.
