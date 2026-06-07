# Job Boards

Boards we monitor, with how accessible each is to pull listings programmatically. Two separate questions per board:

- **Read** = can we pull the *listings*? **Apply** = can we *submit* an application (harder; usually login/forms/captcha and often against ToS — kept manual for now).
- **Bulk** = can we pull the *entire* current set at once (so we filter locally), or only a slice?

Readers live in `src/jobkit/jobs/boards/` (one adapter per source) behind the `fetch-jobs` console script:

```bash
uv run fetch-jobs                         # all boards, newest listings, digest uv run fetch-jobs anesl --limit 10        # one board uv run fetch-jobs anesl --new-only        # only postings new since last run (state in .cache/) uv run fetch-jobs anesl --all-pages --max-pages 50   # deep crawl (slow; polite 1s sleeps) uv run fetch-jobs --json                  # structured JSON
```

Be polite: real User-Agent (the `http.fetch` helper sets one), low request rate, cache. Reading listings only — no auto-applying.

| Board | URL | Read | Bulk (entire set?) | Apply | Status |
|---|---|---|---|---|---|
| ANESL | https://cafe.anesl.com/joblist.aspx | curl | **Yes — full DB** (~4,005 jobs, ~41 postback pages @ size 100) | via `hr@anesl.com` (their matching system) | ✅ `anesl` |
| SeriousTeachers | https://www.seriousteachers.com | curl (needs full UA) | Partial — no pagination (~10/page); full set only via country×subject cross-crawl (~500 reqs) | login-gated form (`apply_url` captured) | ✅ `seriousteachers` |
| ESL Cafe — modern board | https://www.eslcafe.com/jobs/* | **JSON API** | **Yes** — paginated listing API across all 3 boards (korea/china/international) | email / external form (often a Google Form) | ✅ `eslcafe-modern` |
| Ajarn | https://www.ajarn.com/recruitment/jobs | curl | **Yes** — full board on one page (~142 jobs; `?page=N` returns the same set) | direct employer email (CF-obfuscated, decoded) | ✅ `ajarn` |
| TEFL.com | https://www.tefl.com/job-seeker/ | curl | **Yes** — `?pageNo=N` pagination (~175 jobs across ~18 pages); detail pages carry JSON-LD `JobPosting` | on-site, login-gated (`apply_url` captured) | ✅ `tefl` |

## Per-site findings (assessed 2026-05-28)

### ANESL — best source, full DB pullable
- IIS/ASP.NET WebForms. No robots.txt/sitemap/RSS/export, but `joblist.aspx` reports **Total Records: 4005** and paginates via an `AspNetPager` `__doPostBack`. The page-size dropdown goes to **100**, collapsing the DB to **~41 pages**. No `__EVENTVALIDATION` field; postbacks just need the carried-forward `__VIEWSTATE`/`__VIEWSTATEGENERATOR` + `__EVENTTARGET`/`__EVENTARGUMENT`.
- Detail pages are a clean label/value table (Position ID, Employer's Type, Location, Salary/M, Degree, Age, Nationality, Vacancy, Airfare, …). Apply routes through `hr@anesl.com`.
- Adapter: `fetch_listings(limit)` (page 1, cheap), `list_page_ids(max_pages)`, `fetch_all(max_pages, limit)` (full crawl, 1s sleeps). Recommended daily monitor: `fetch_listings` + `--new-only`.

### SeriousTeachers — static but no pagination
- Server-rendered; **requires the full Chrome UA** (a bare `Mozilla/5.0` gets 403). No sitemap/RSS (those 403). Every list page caps at ~10 postings and the "next/prev" are carousel controls — **no real pagination**. The only route to the full set is the country×subject cross (`/0/<countryId>/<subjectId>`): ~36 countries × 14 subjects ≈ **~500 list requests**, yielding several hundred to ~1–2k live postings (China ≈40).
- Postings at `/job_details/<id>/0/<slug>` with fields: Required Degrees, Fields of Expertise, Salary, country, description. Apply is **login-gated** (`/te2/Login/<jobId>/<employerId>`); employer emails are cf-obfuscated, so we capture `fields["apply_url"]`, not an email.
- Adapter: `fetch_listings(limit)` (homepage + global subject pages, freshest ~50–140), `fetch_all(max_pages, limit)` (bounded country×subject crawl).

### ESL Cafe — modern board (the live job board; the phpBB forum is intentionally not used)
- AngularJS 1.x SPA at `/jobs/{korea,china,international}`. Data loads from a JSON API; no browser needed once the request shape is right. The board *directory* is `/api/list/JobBoardList` (korea=1, china=2, international=3).
- **Listings** — `GET /api/list/PostAJobList?jobBoardSlug={korea|china|international}&page=N&size=60` `&name=&sortColumn=SortOrder&sortType=asc&jobType=1` (jobType 1 = regular, 2 = paid ads). Returns `{ paging:{page,lastPage,total}, data:[{jobTitle,company,slug,statusStartDate}] }`. (The earlier "500s anonymously" was just wrong params — it needs `jobBoardSlug`+`jobType`, not `boardId`.) Live counts seen 2026-06-01: korea ~169, china ~96, international ~134.
- **Detail** — `GET /postajob-detail/{slug}` is **server-rendered HTML**; the full free-text description lives in `div.job-details` (with `div.author-desc` carrying location / `Posted by:` company / optional `Contact:` email). Emails are **Cloudflare-obfuscated** (`span.__cf_email__` `data-cfemail` hex XOR) and are decoded by the adapter; external apply links (Google Forms, careers sites) are captured as `apply_url`.
- Adapter `eslcafe_modern`: `fetch_listings(limit, board="international")` (page 1 + one detail fetch each) and `fetch_all(boards, max_pages, limit)` (all 3 boards, paginated, polite 1s sleeps). Free-text body → run through `enrich.py` for normalized fields.

## To assess (add more boards here)

<!-- e.g. Indeed, LinkedIn, Teach Away, ESL Authority, Idealist, Glassdoor, Actalent portal, etc. -->
