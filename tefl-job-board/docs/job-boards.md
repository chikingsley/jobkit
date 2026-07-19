# Job Boards

Boards we monitor, with how accessible each is to pull listings programmatically. Two separate questions per board:

- **Read** = can we pull the *listings*? **Apply** = can we *submit* an application (harder; usually login/forms/captcha and often against ToS — kept manual for now).
- **Bulk** = can we pull the *entire* current set at once (so we filter locally), or only a slice?

Readers live in `src/jobkit/jobs/boards/` (one adapter per source). `jobs` updates the durable
SQLite inventory at `../job-search/job-data/jobs.sqlite`:

```bash
uv run jobs refresh             # update ../job-search/job-data/jobs.sqlite
uv run jobs refresh tefl ajarn  # refresh selected boards
uv run jobs refresh --latest seriousteachers anesl  # quick pass; preserve unseen rows
uv run jobs runs                # durable discovery/hydration progress and failures
uv run jobs stats
uv run jobs countries
```

Be polite: real User-Agent (the `http.fetch` helper sets one), low request rate, cache. Reading listings only — no auto-applying.

Full `uv run jobs refresh` is intentionally slow: ANESL fetches every detail page in its large
historical database, SeriousTeachers crawls the country×subject grid, and several adapters sleep
between requests. The complete discovery ledger is committed before hydration; every detail result
is committed separately. A failed run is visible in `jobs runs` and the next identical refresh
resumes only pending or failed details. Use board-specific refreshes for quick checks, and reserve
the all-board refresh for when you actually want the durable SQLite inventory brought fully current.

Closure is governed by code-level board policy in `src/jobkit/jobs/registry.py`: a board that
proves a complete current set may close active DB rows missing from that refresh. Production full
discovery follows source-reported pagination, a finite source matrix, or source exhaustion; page
caps remain explicit adapter diagnostics rather than normal inventory policy.

| Board | URL | Read | Bulk (entire set?) | Apply | Status |
|---|---|---|---|---|---|
| ANESL | <https://cafe.anesl.com/joblist.aspx> | curl | **Yes — full DB** (~4,005 jobs, ~41 postback pages @ size 100) | via `hr@anesl.com` (their matching system) | ✅ `anesl` |
| SeriousTeachers | <https://www.seriousteachers.com> | curl (needs full UA) | **Yes via finite matrix** — no pagination (~10/page); full set requires the country×subject cross-crawl (~500 reqs) | one optional headless login per hydration run resolves gated links → on-site respond form or external employer site; no emails exposed | ✅ `seriousteachers` |
| ESL Cafe — modern board | <https://www.eslcafe.com/jobs/>* | **JSON API** | **Yes** — paginated listing API across all 3 boards (korea/china/international) | email / external form (often a Google Form) | ✅ `eslcafe-modern` |
| Ajarn | <https://www.ajarn.com/recruitment/jobs> | curl | **Yes** — full board on one page (~142 jobs; `?page=N` returns the same set) | direct employer email (CF-obfuscated, decoded) | ✅ `ajarn` |
| TEFL.com | <https://www.tefl.com/job-seeker/> | curl | **Yes** — `?pageNo=N` pagination (~175 jobs across ~18 pages); detail pages carry JSON-LD `JobPosting` | on-site, login-gated (`apply_url` captured) | ✅ `tefl` |

Deep per-adapter notes (pagination mechanics, API shapes, email de-obfuscation) live in [board-notes.md](board-notes.md).

## To assess (add more boards here)

<!-- e.g. Indeed, LinkedIn, Teach Away, ESL Authority, Idealist, Glassdoor, Actalent portal, etc. -->
