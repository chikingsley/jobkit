# jobkit

Canonical local workspace for Chibuzor Ejimofor job applications, resume variants, outreach drafts, references, and application tracking.

This repository contains personal contact information and job-search records. Keep it private if it is published to GitHub.

## Layout

```text
src/jobkit/              Python package (uv project)
  llm.py                 Superwhisper LLM client (shared by job enrichment)
  jobs/                  pull listings -> normalize -> SQLite: db, registry, http, models, enrich
    boards/              one adapter per site (anesl, seriousteachers, eslcafe_modern, ajarn, tefl)
  resume/                build.py (`build-resume` script) + assets/ (HTML template + print CSS)
resumes/                 source resume markdown + pdfs/ (generated PDF output)
job-data/                jobs.sqlite + application-tracker.csv + job documents/ (credential PDFs)
docs/                    board notes, job-search playbook, product plans, and design notes
templates/               reusable email + reference templates
leads/<lead-slug>/       an ACTIVE lead: application.md + job-description.md (created on demand)
archive/                 dead/closed material (see Archiving)
  leads/<lead-slug>/     a closed lead's application.md + job-description.md together
  interview-prep/        closed interview-prep packets
  old-resumes/           superseded resume files
.agents/skills/          local skills for resume/job-application agents
```

No empty or single-item folders are kept around: `leads/<slug>/` is created when there's an
active lead, and removed/moved to `archive/leads/` when it closes.

## Build Resumes

This is a uv project: `pandoc` (bundled via `pypandoc-binary`) and `weasyprint`
are installed project-locally in `.venv` — nothing global. Run `uv sync` once
after cloning, then use the `build-resume` console script (the `just` recipes wrap it):

```bash
uv run build-resume --all          # or: just all
uv run build-resume pm             # alias -> project-management-resume (just pm)
uv run build-resume master teaching
uv run build-resume --list         # show available resume stems
```

Outputs go to `resumes/pdfs/`. Lint/typecheck like the other Python projects:
`just lint`, `just fmt`, `just typecheck` (ruff + ty).

## Job Boards

`docs/job-boards.md` tracks the boards we monitor, how scrapable each is, and whether the *entire* set is
pullable. Readers live in `src/jobkit/jobs/boards/` (one adapter per source). `jobs` is the
stateful job inventory command:

```bash
uv run jobs refresh             # refresh all boards into job-data/jobs.sqlite
uv run jobs refresh anesl tefl  # refresh selected boards
uv run jobs stats               # board/status counts
uv run jobs countries           # active country counts
```

Implemented adapters: **anesl** (cafe.anesl.com — full ~4k-job DB pullable), **seriousteachers**
(static; no pagination, country×subject crawl for full coverage), **eslcafe-modern**
(eslcafe.com/jobs — the AngularJS job board, JSON listing API across the korea/china/international
boards + server-rendered detail pages), **ajarn** (ajarn.com — Thailand board, server-rendered
HTML, direct employer emails), **tefl** (tefl.com — global ELT board, JSON-LD detail pages,
`?pageNo` pagination). See `docs/job-boards.md` for the bulk-access findings per board. Reading
listings is in scope; *auto-applying* is deliberately not — those go through email/logged-in forms
and are handled manually.

`job-data/jobs.sqlite` is the source of truth for scraped postings. Refreshes upsert by
`(board, job_id)`, preserving manual statuses such as `applied` and `ignored`. The refresh policy
lives in `jobs/registry.py`; boards that produce a complete current set close DB rows missing from
that refresh. Page caps and crawl depth are code-level board policy, not day-to-day CLI flags.

Enrichment flattens every board into one consistent column set (see `jobs/enrich.py`). Every row
carries a final `raw` column with the full unparsed text that was pulled, alongside the extracted
fields. Routine DB refresh uses the offline extractor; LLM enrichment should be reserved for
selected ranking or outreach work, not the whole periodic refresh.

**Field extraction.** Structured boards (ANESL) map cleanly; free-text boards use transparent
offline heuristics during refresh. Claude-backed cleanup remains available in `jobs/enrich.py` for
selected downstream workflows, but it is not part of the default inventory update.

### Send-out file naming

The file emailed to recruiters is named **`Chibuzor Ejimofor - Resume.pdf`** — that is
just the *send* filename for whichever variant fits the role (usually
`project-management-resume.pdf`). It is a rename at send time, not a stored artifact;
do not keep a committed copy under that name.

## Sending Email (gws-profile)

`gws` has no built-in multi-account support, so use the `gws-profile` wrapper
(`~/.local/bin/gws-profile`) which switches `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`:

```bash
gws-profile list
gws-profile chibuzor auth status                                 # confirm account before sending
gws-profile cheez2012 auth login -s gmail,drive,calendar,tasks   # interactive (browser) — adds Gmail scope
```

Profiles: `chibuzor` → <chibuzor.ejimofor@gmail.com> (logged in, full Gmail scopes),
`cheez2012` → <cheez2012@gmail.com> (calendar/tasks only until the login above adds Gmail).

### Sending a message

Gmail's API takes a base64url-encoded RFC822 message in `raw`, and `userId` must be
passed in `--params` (not the body). Build + send:

```bash
RAW=$(python3 - <<'PY'
import base64, email.message
m = email.message.EmailMessage()
m["To"] = "recruiter@example.com"
m["Subject"] = "Updated resume and references - Project Manager"
m.set_content("Hi ...")              # plain-text body
# attach a resume PDF:
# m.add_attachment(open("resumes/pdfs/project-management-resume.pdf","rb").read(),
#                  maintype="application", subtype="pdf", filename="Chibuzor Ejimofor - Resume.pdf")
print(base64.urlsafe_b64encode(m.as_bytes()).decode())
PY
)
gws-profile chibuzor gmail users messages send \
  --params '{"userId":"me"}' --json "{\"raw\":\"$RAW\"}"
```

To stage instead of send, swap `messages send` for `drafts create` with
`--json "{\"message\":{\"raw\":\"$RAW\"}}"`.

## Operating Rules

1. Treat this repo as the official job-search source of truth.
2. For each new lead, add a row to `application-tracker.csv` and create `leads/<lead-slug>/`
   holding `application.md` (status, next action, fit notes) and `job-description.md`
   (raw recruiter/job text). Point the CSV `job_file` column at that folder.
3. Generate tailored resume PDFs into `resumes/pdfs/`; keep markdown sources editable.
4. Keep sensitive identifiers, login details, and unrelated personal records out of this repo.
5. Before sending emails, verify the active Gmail profile/account separately.

## Archiving

When a lead goes dead/closed:

1. Set its row `status` in `application-tracker.csv` to `closed-dead` (or similar) and
   clear `next_action`. The CSV keeps every row as the running history.
2. Move its whole `leads/<lead-slug>/` folder into `archive/leads/<lead-slug>/`.
3. Update the CSV `job_file` column to the archived path.

Superseded resume files go in `archive/old-resumes/`.

## Known Prior Source

Originated on home-mac at `~/GitHub/job-search` (itself copied from
`/Users/simonpeacocks/Documents/Personal Records/Resumes`), then consolidated and
restructured into this single workspace at `~/github/jobkit` on gmk-server.
