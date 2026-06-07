# Board implementation notes

Per-adapter scraping details (pagination mechanics, API shapes, obfuscation handling) for the boards in `job-boards.md`. Adapters live in `src/jobkit/jobs/boards/`.

## ANESL — best source, full DB pullable

- IIS/ASP.NET WebForms. No robots.txt/sitemap/RSS/export, but `joblist.aspx` reports **Total Records: 4005** and paginates via an `AspNetPager` `__doPostBack`. The page-size dropdown goes to **100**, collapsing the DB to **~41 pages**. No `__EVENTVALIDATION` field; postbacks just need the carried-forward `__VIEWSTATE`/`__VIEWSTATEGENERATOR` + `__EVENTTARGET`/`__EVENTARGUMENT`.
- Detail pages are a clean label/value table (Position ID, Employer's Type, Location, Salary/M, Degree, Age, Nationality, Vacancy, Airfare, …). Apply routes through `hr@anesl.com`.
- Adapter: `fetch_listings(limit)` (page 1, cheap), `list_page_ids(max_pages)`, `fetch_all(max_pages, limit)` (full crawl, 1s sleeps). Recommended daily monitor: `fetch_listings` + `--new-only`.

### SeriousTeachers — static but no pagination

- Server-rendered; **requires the full Chrome UA** (a bare `Mozilla/5.0` gets 403). No sitemap/RSS (those 403). Every list page caps at ~10 postings and the "next/prev" are carousel controls — **no real pagination**. The only route to the full set is the country×subject cross (`/0/<countryId>/<subjectId>`): ~36 countries × 14 subjects ≈ **~500 list requests**, yielding several hundred to ~1–2k live postings (China ≈40).
- Postings at `/job_details/<id>/0/<slug>` with fields: Required Degrees, Fields of Expertise, Salary, country, description. Apply is **login-gated** (`/te2/Login/<jobId>/<employerId>`); employer emails are cf-obfuscated, so we capture `fields["apply_url"]`, not an email.
- **Headless login** (verified 2026-06-06): the login is a plain ASP.NET form POST (`email`, `password`, `idjob=0`, `idemployer=0`, `__RequestVerificationToken` scraped from the page; success = 302 to `/te2/seriousteachers_panel`). With `SERIOUSTEACHERS_EMAIL`/`SERIOUSTEACHERS_PASSWORD` set (env or repo `.env`), the adapter logs in via httpx and resolves each gated apply link to its real destination — usually the on-site respond form (`/te2/respond/<jobId>/<employerId>`), sometimes an external employer site (e.g. reallygreatteachers.com). Even logged in, **no employer emails are exposed anywhere** — applying means submitting their respond form (kept manual per policy). The session cookie is HttpOnly, so it can't be lifted from a browser; credential login is the only headless route.
- Adapter: `fetch_listings(limit)` (homepage + global subject pages, freshest ~50–140), `fetch_all(max_pages, limit)` (bounded country×subject crawl).

### ESL Cafe — modern board (the live job board; the phpBB forum is intentionally not used)

- AngularJS 1.x SPA at `/jobs/{korea,china,international}`. Data loads from a JSON API; no browser needed once the request shape is right. The board *directory* is `/api/list/JobBoardList` (korea=1, china=2, international=3).
- **Listings** — `GET /api/list/PostAJobList?jobBoardSlug={korea|china|international}&page=N&size=60` `&name=&sortColumn=SortOrder&sortType=asc&jobType=1` (jobType 1 = regular, 2 = paid ads). Returns `{ paging:{page,lastPage,total}, data:[{jobTitle,company,slug,statusStartDate}] }`. (The earlier "500s anonymously" was just wrong params — it needs `jobBoardSlug`+`jobType`, not `boardId`.) Live counts seen 2026-06-01: korea ~169, china ~96, international ~134.
- **Detail** — `GET /postajob-detail/{slug}` is **server-rendered HTML**; the full free-text description lives in `div.job-details` (with `div.author-desc` carrying location / `Posted by:` company / optional `Contact:` email). Emails are **Cloudflare-obfuscated** (`span.__cf_email__` `data-cfemail` hex XOR) and are decoded by the adapter; external apply links (Google Forms, careers sites) are captured as `apply_url`.
- Adapter `eslcafe_modern`: `fetch_listings(limit, board="international")` (page 1 + one detail fetch each) and `fetch_all(boards, max_pages, limit)` (all 3 boards, paginated, polite 1s sleeps). Free-text body → run through `enrich.py` for normalized fields.
