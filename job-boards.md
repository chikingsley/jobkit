# Job Boards

Boards we monitor, with how accessible each is to pull listings programmatically. Two separate questions per board:

- **Read** = can we pull the *listings*? **Apply** = can we *submit* an application (harder; usually login/forms/captcha and often against ToS — kept manual for now).
- **Bulk** = can we pull the *entire* current set at once (so we filter locally), or only a slice?

Readers live in `src/jobkit/jobs/boards/` (one adapter per source) behind the `fetch-jobs` console script:

```bash
uv run fetch-jobs                                    # all boards, newest listings, digest
uv run fetch-jobs anesl --limit 10                   # one board
uv run fetch-jobs anesl --new-only                   # only postings new since last run (state in .cache/)
uv run fetch-jobs anesl --all-pages --max-pages 50   # deep crawl (slow; polite 1s sleeps)
uv run fetch-jobs --json                             # structured JSON
```

Be polite: real User-Agent (the `http.fetch` helper sets one), low request rate, cache. Reading listings only — no auto-applying.

| Board | URL | Read | Bulk (entire set?) | Apply | Status |
|---|---|---|---|---|---|
| ANESL | https://cafe.anesl.com/joblist.aspx | curl | **Yes — full DB** (~4,005 jobs, ~41 postback pages @ size 100) | via `hr@anesl.com` (their matching system) | ✅ `anesl` |
| SeriousTeachers | https://www.seriousteachers.com | curl (needs full UA) | Partial — no pagination (~10/page); full set only via country×subject cross-crawl (~500 reqs) | headless login (creds in `.env`) resolves each gated link → on-site respond form or external employer site; no emails exposed | ✅ `seriousteachers` |
| ESL Cafe — modern board | https://www.eslcafe.com/jobs/* | **JSON API** | **Yes** — paginated listing API across all 3 boards (korea/china/international) | email / external form (often a Google Form) | ✅ `eslcafe-modern` |
| Ajarn | https://www.ajarn.com/recruitment/jobs | curl | **Yes** — full board on one page (~142 jobs; `?page=N` returns the same set) | direct employer email (CF-obfuscated, decoded) | ✅ `ajarn` |
| TEFL.com | https://www.tefl.com/job-seeker/ | curl | **Yes** — `?pageNo=N` pagination (~175 jobs across ~18 pages); detail pages carry JSON-LD `JobPosting` | on-site, login-gated (`apply_url` captured) | ✅ `tefl` |

Deep per-adapter notes (pagination mechanics, API shapes, email de-obfuscation) live in [docs/board-notes.md](docs/board-notes.md).

## To assess (add more boards here)

<!-- e.g. Indeed, LinkedIn, Teach Away, ESL Authority, Idealist, Glassdoor, Actalent portal, etc. -->
