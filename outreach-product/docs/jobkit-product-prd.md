# Jobkit Product PRD

Status: V1 implementation in progress
Last updated: 2026-07-11
Scope: personal ESL/teaching job search product, Cloudflare-first backend, web dashboard, Expo mobile app

## 1. Summary

Jobkit should become a private Indeed-like job search and application workstation for English teaching jobs. It should keep the current board ingestion pipeline, but expose the inventory through a Cloudflare-hosted product surface with strong search, faceted filtering, multi-sort, job detail review, email draft creation, and safe manual application tracking.

The app is not an unattended auto-apply bot. It is a job inventory, triage, drafting, and application evidence system. It may submit an application only after the user has reviewed and explicitly approved the exact immutable message for that job. It must verify and record the result rather than inferring success from a request alone.

## 2. Why This Exists

Current jobkit is useful but still CLI-shaped:

- Jobs live in `job-search/job-data/jobs.sqlite`.
- Refresh is now stateful and upserts by `(board, job_id)`.
- Country counts, board counts, salary visibility, and application channels are queryable.
- Outreach is draft-first, but there is no UI for selecting jobs, reviewing emails, or managing application state.

The pain is not "we need another CSV." The pain is deciding what is worth applying to, keeping that state clean, and moving from a scraped posting to a reviewed application action without losing context.

## 3. Current Data Reality

Snapshot from `job-search/job-data/jobs.sqlite` on 2026-06-13:

- Active jobs: 2,660.
- DB size: about 20 MB.
- Active jobs with salary text: 2,482, or 93.3 percent.
- Active jobs with apply email: 1,012.
- Active jobs with apply URL: 1,760.
- Active jobs with posted date: 999.

Board breakdown:

| Board | Active | Salary rows | Email rows | URL rows |
|---|---:|---:|---:|---:|
| seriousteachers | 1,498 | 1,422 | 0 | 1,496 |
| anesl | 502 | 502 | 502 | 0 |
| eslcafe-modern | 439 | 366 | 351 | 178 |
| ajarn | 159 | 136 | 159 | 24 |
| tefl | 62 | 56 | 0 | 62 |

Top active countries:

| Country | Jobs |
|---|---:|
| China | 637 |
| Thailand | 225 |
| South Korea | 209 |
| Taiwan | 83 |
| Italy | 83 |
| Japan | 80 |
| United Kingdom | 73 |
| Mexico | 67 |
| Indonesia | 56 |
| Hong Kong | 53 |

Implications:

- Country filtering is already a first-class feature.
- Salary visibility is high, but salary is currently text, not normalized enough for reliable numeric sort.
- `first_seen_at` should be the primary recency field. `posted_date` is useful when present but too sparse to be the only recency source.
- Apply method should be explicit because boards differ sharply: ANESL/Ajarn are email-heavy, SeriousTeachers is form/link-heavy.

## 4. Product Goals

1. Review all active teaching jobs from one clean interface.
2. Search and filter by the things that matter: country, location, source, salary visibility, apply method, recency, status, and teaching-specific fit.
3. Sort by multiple fields, including country, first seen, salary-derived fields, source, and status.
4. Keep scraped inventory separate from application state.
5. Create Gmail drafts from selected jobs without sending.
6. Track events: viewed, saved, ignored, draft created, source opened, prefilled, manually submitted, replied, closed.
7. Support SeriousTeachers safely: generate and revise a draft, require exact-message approval, submit through the authenticated form, then verify and record the result.
8. Make the web dashboard useful first, then provide an Expo mobile app that consumes the same API and supports review, saved searches, and light triage.

## 5. Non-Goals

- No unattended or bulk application submission.
- No submission without approval of the exact job and immutable message version.
- No bulk cold-email blasting.
- No dependency on private Indeed APIs or WAF-bypassing scraping.
- No CSV export as a normal workflow.
- No second source of truth outside the database.
- No mobile-only product architecture that makes the dense desktop workflow worse.

## 6. Users

Primary user:

- Chibuzor, reviewing overseas English teaching jobs, prioritizing countries and salary, and sending applications through email or board forms.

Future user:

- ESL job seeker who wants a job board, resume/outreach helper, follow-up tracker, and transparent application log.

## 7. Product Principles

- Inventory is not application state.
- Manual application confirmation is required.
- Draft-first for email.
- URL state matters: filters, sort, page, and selected job should be shareable/bookmarkable.
- Data quality should be visible. The UI should show when salary, posted date, country, or apply method is inferred.
- Cloudflare from day one for product backend and web hosting.
- Expo mobile should use the same API and types, not a separate backend.

## 8. Platform Decision

### Cloudflare-first backend and web

Use Cloudflare Workers as the API/runtime, D1 as the product database, and Workers Static Assets for the React web app.

Rationale:

- Current job inventory is already SQLite-shaped.
- Cloudflare D1 is the natural target for relational job data.
- D1 supports FTS5 full-text search and JSON functions, which fit job search and board-normalized metadata.
- Workers Static Assets can serve the React web app and Worker code in one deployment unit.
- Workers storage guidance positions D1 for lightweight relational data, R2 for object/blob storage, KV for config, Queues for background jobs, and Durable Objects for strongly consistent coordination.

### Expo mobile app

Use Expo Router for the mobile app. It provides file-based routing across Android, iOS, and web, deep links, typed routes, and native navigation behavior.

Expo app responsibilities:

- Review saved searches.
- Browse job cards and detail screens.
- Save, ignore, and mark manual statuses.
- Review already-created drafts.
- Trigger draft creation through the Cloudflare API.
- Open source links in browser/webview only when safe.
- Later: receive push reminders for due follow-ups or high-priority new jobs.

Do not use Expo API routes as the product backend if the product backend is Cloudflare-first. Expo API routes are useful for Expo-hosted/server-output apps, but jobkit's authoritative API should live in Workers so web and mobile share the same backend.

### Web first, mobile first-class

The first full UI should be web because the core workflow is dense: multi-column tables, multi-sort, side-by-side detail review, bulk selection, draft preview, and board diagnostics.

The Expo app is still first-class, but its MVP should focus on mobile-appropriate workflows:

- saved search review
- job detail reading
- quick save/ignore
- open source
- check draft/application status
- lightweight alerts

## 9. UI Stack

### Web

Recommended:

- React + Vite.
- Cloudflare Vite plugin / Workers Static Assets.
- TanStack Router for typed URL/search state.
- TanStack Table for controlled table state, filtering, sorting, pagination, column visibility, and row selection.
- shadcn/ui for web components.

Table behavior:

- The API should support server-side filtering, sorting, pagination, and counts from the start.
- The UI can still load all current rows for early personal use because 2,660 rows is small, but the API contract should not assume that stays true.
- Table state should be serializable into search params.

### Mobile

Recommended baseline:

- Expo Router.
- NativeWind for styling.
- React Native Reusables for shadcn-like primitives.

NativeWind choice:

- Use NativeWind v4 as the production baseline unless a spike proves v5 is safe for the selected Expo SDK. Current NativeWind v5 docs label it pre-release and not intended for production.
- Keep theme tokens aligned with the web design system where practical, but do not force web-like density onto mobile.

React Native Reusables:

- Good fit for shadcn-style copy-paste components in React Native.
- Should be treated as source components we can own and adapt, not a black-box design system.

NativewindUI:

- Relevant as a component/template source for native-feeling mobile screens.
- Should be evaluated in a UI spike before becoming a dependency.
- Do not make paid or license-restricted components part of the core product until licensing and source availability are checked.

## 10. Core User Flows

### 10.1 Refresh inventory

As the user, I can refresh all job sources and know what changed.

Acceptance criteria:

- Refresh updates existing jobs by `(board, job_id)`.
- New postings are added.
- Missing postings from complete boards become closed/stale according to board policy.
- Manual states such as `ignored`, `applied`, and future application events are preserved.
- UI exposes the last refresh time, per-board counts, and errors.

### 10.2 Search and filter jobs

As the user, I can find jobs by country, location, keyword, salary, source, recency, and apply method.

Acceptance criteria:

- Keyword search covers title, company/school, location, country, description, and raw text.
- Country filter supports one or many countries.
- Source filter supports one or many boards.
- Apply method filter supports `email`, `external_url`, `login_gated_form`, `unknown`, and `manual`.
- Recency supports `first_seen_at`, `last_present_at`, and `posted_date` when present.
- Salary filter supports `salary_visible` immediately and numeric salary ranges after normalization exists.
- URL reflects filters.

### 10.3 Sort jobs

As the user, I can multi-sort the table.

Acceptance criteria:

- Sort can include multiple fields.
- Supported initial fields: `first_seen_at`, `country`, `title`, `company`, `board`, `salary_visible`, `apply_method`, `status`.
- Supported later fields: `salary_min`, `salary_max`, `salary_period`, `fit_score`, `start_date_normalized`.
- Sort state is reflected in the URL and saved filters.

### 10.4 Review selected job

As the user, I can select a job and see a structured detail pane.

Acceptance criteria:

- Desktop shows list/table and detail in one browsing context.
- Mobile opens a detail route.
- Detail includes source, title, company, country, location, salary, start date, apply method, original URL, apply URL/email, description, raw extracted fields, and event history.
- Detail shows data quality flags: missing country, inferred country, salary raw only, posted date missing, login-gated apply, unknown apply route.

### 10.5 Save, ignore, and shortlist

As the user, I can quickly triage jobs.

Acceptance criteria:

- `saved` and `ignored` are application-layer states, not destructive job deletion.
- Ignored jobs can be hidden by default and restored.
- Every action writes an event row.

### 10.6 Draft an email application

As the user, I can create a Gmail draft for email-based jobs.

Acceptance criteria:

- Button appears only when an email route exists or when the user manually adds an email.
- The UI shows the message before draft creation.
- Draft creation calls the backend and creates a Gmail draft, not a sent email.
- Gmail account/profile is explicit.
- Event log records `draft_created` with Gmail draft/thread identifiers.
- The app never sends email directly in MVP.

### 10.7 Open external or login-gated apply flow

As the user, I can open source/apply pages and track what happened.

Acceptance criteria:

- `Open source` opens the source posting.
- `Open apply` opens the apply route if known.
- Opening a route records `source_opened` or `apply_opened`.
- The user can manually mark `submitted` only after they confirm they submitted outside the app.

### 10.8 SeriousTeachers reviewed submission

As the user, I can review, revise, approve, and submit a SeriousTeachers application from JobKit.

Acceptance criteria:

- The private-board sync resolves the job and employer identifiers.
- A tailored message exists before the job enters review.
- Revisions create a new immutable draft version.
- The user explicitly approves the exact message version.
- Submission refuses unapproved, superseded, or duplicate versions.
- The executor logs in, fetches a fresh antiforgery token, and submits the approved message.
- The application is marked applied only after an authoritative SeriousTeachers verification signal is recorded.

### 10.9 Candidate profile, preferences, and qualification matching

The private beta stores an editable candidate profile and preference set in D1. Matching evaluates
each mapped requirement as `match`, `conflict`, `unknown`, or `preference` and presents both the
overall state and its evidence. Hard conflicts are hidden by default but remain available through
“Show ineligible”; missing data remains visible as “Needs verification.”

Initial preference controls cover countries, audiences, full-time/part-time/contract work, benefits
including visa sponsorship, and minimum monthly USD. Theme is a device-local interface setting,
not matching data. Profile and preference JSON documents carry explicit schema versions; migrations
upgrade and persist older documents instead of transforming them on every read. The initial 14
Serious Teachers jobs use a manually reviewed criterion map; future ingestion should normalize
requirements before expanding this beyond the specimen set.

Job compensation is normalized at import into amount, currency, period, qualifier, source,
confidence, and notes fields. Queue and detail views consume that single stored representation;
manually reviewed corrections are preserved across later imports.

### 10.10 Private application documents

Candidate documents live in a private R2 bucket and are indexed by D1 metadata. Objects are never
published as static assets. All upload, listing, view, and delete requests require the same private
beta authorization as the rest of the API. Authenticated reads stream object bodies with private,
no-store caching so the same files can later be attached to outbound email workflows.

## 11. Data Model

The existing `jobs` table remains the inventory root. Product work should add application/event tables instead of overloading scraped fields.

### 11.1 Jobs

Current key:

```sql
PRIMARY KEY (board, job_id)
```

Important existing fields:

- `board`
- `job_id`
- `url`
- `title`
- `company`
- `location`
- `country`
- `salary`
- `currency`
- `degree_required`
- `contract_length`
- `start_date`
- `apply_email`
- `apply_url`
- `posted_date`
- `description`
- `raw`
- `raw_json`
- `normalized_json`
- `status`
- `first_seen_at`
- `last_seen_at`
- `last_present_at`
- `last_checked_at`
- `closed_at`

Near-term derived fields:

- `apply_method`
- `salary_visible`
- `salary_min`
- `salary_max`
- `salary_currency`
- `salary_period`
- `salary_confidence`
- `posted_date_confidence`
- `country_confidence`
- `source_url_canonical`

### 11.2 Job events

```sql
CREATE TABLE job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'user',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (board, job_id) REFERENCES jobs(board, job_id)
);
```

Event types:

- `viewed`
- `saved`
- `ignored`
- `unignored`
- `shortlisted`
- `source_opened`
- `apply_opened`
- `draft_previewed`
- `draft_created`
- `prefill_ready`
- `prefilled`
- `submitted_manually`
- `marked_applied`
- `reply_detected`
- `closed_detected`
- `note_added`

### 11.3 Application state

Use a derived status view for most UI states rather than mutating a single status column for every event.

Initial statuses:

- `active`
- `saved`
- `ignored`
- `drafted`
- `opened`
- `prefilled`
- `applied`
- `replied`
- `closed`

Rules:

- `applied` requires `submitted_manually` or explicit `marked_applied`.
- `drafted` does not imply `applied`.
- `prefilled` does not imply `applied`.
- Scrape closure does not erase application history.

### 11.4 Full-text search

Use an FTS5 virtual table in D1/SQLite:

```sql
CREATE VIRTUAL TABLE job_search_fts USING fts5(
    title,
    company,
    location,
    country,
    description,
    raw,
    content='jobs',
    content_rowid='rowid'
);
```

Implementation detail:

- D1 supports FTS5, but D1 export has caveats with virtual tables. Keep FTS creation in migrations and be prepared to rebuild FTS after exports/imports.

### 11.5 Saved filters

```sql
CREATE TABLE saved_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    query_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Saved filter examples:

- China, salary visible, newest first.
- Korea/Japan/Taiwan, email apply only.
- SeriousTeachers, not opened, degree required empty.
- Online jobs, salary visible, not ignored.

### 11.6 Outreach messages

```sql
CREATE TABLE outreach_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    job_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    to_email TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    gmail_draft_id TEXT NOT NULL DEFAULT '',
    gmail_thread_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (board, job_id) REFERENCES jobs(board, job_id)
);
```

States:

- `previewed`
- `draft_created`
- `sent_detected`
- `reply_detected`
- `closed`

## 12. API Requirements

Base API shape:

- `GET /api/jobs`
- `GET /api/jobs/:board/:jobId`
- `GET /api/jobs/facets`
- `POST /api/jobs/:board/:jobId/events`
- `POST /api/jobs/:board/:jobId/draft`
- `POST /api/jobs/refresh`
- `GET /api/refresh-runs`
- `GET /api/saved-filters`
- `POST /api/saved-filters`
- `PATCH /api/saved-filters/:id`
- `DELETE /api/saved-filters/:id`

`GET /api/jobs` query parameters:

- `q`
- `country`
- `location`
- `source`
- `status`
- `apply_method`
- `salary_visible`
- `posted_after`
- `first_seen_after`
- `sort`
- `page`
- `page_size`
- `selected`

Example:

```text
/jobs?q=teacher&country=China&country=Japan&source=seriousteachers&apply_method=login_gated_form&sort=first_seen_at:desc,country:asc
```

Response should include:

- `items`
- `page`
- `page_size`
- `total`
- `facets`
- `sort`
- `query`

## 13. Web UX Requirements

### Main jobs page

Desktop layout:

- Header toolbar with keyword search, country selector, saved filter selector, refresh status.
- Left/main area: table or dense cards.
- Right pane: selected job detail.
- Bottom or side area: event history and draft preview drawer when needed.

Required controls:

- Keyword search input.
- Country multi-select.
- Source multi-select.
- Apply method segmented/multi-select.
- Recency menu.
- Salary visible toggle.
- Status tabs or segmented control.
- Column visibility menu.
- Sort controls through table headers and an explicit multi-sort editor.
- Save, ignore, open source, open apply, draft email, mark manually applied.

No marketing hero. First screen is the working tool.

### Job card/table row fields

- Title.
- Company/school.
- Country and location.
- Salary raw string.
- Salary visible badge.
- Source.
- Apply method.
- First seen.
- Posted date when available.
- Status.
- Short snippet.

### Detail fields

- Source posting link.
- Apply route.
- Full description.
- Extracted fields.
- Raw source fields.
- Fit insights.
- Event history.
- Notes.
- Draft history.

## 14. Mobile UX Requirements

### Navigation

Use Expo Router routes:

```text
app/
  (tabs)/
    jobs/
      index.tsx
      [board]/
        [jobId].tsx
    saved.tsx
    drafts.tsx
    settings.tsx
  filters.tsx
  job-actions.tsx
```

### Mobile screens

Jobs tab:

- Search bar.
- Filter button.
- Saved filter chips.
- Job cards.
- Quick actions: save, ignore, open.

Job detail:

- Title/company/location/salary summary.
- Apply method.
- Fit insights.
- Full description.
- Event timeline.
- Actions bottom bar.

Saved tab:

- Saved jobs grouped by country/source/age.

Drafts tab:

- Draft previews and Gmail draft links.

Settings:

- API endpoint.
- Gmail account status.
- Notification preferences.
- Data sync status.

### Mobile limitations

- No dense multi-column table.
- No bulk actions in MVP.
- No form prefill from mobile in MVP unless a later spike proves a safe browser-extension equivalent.

## 15. Gmail and Outreach

Gmail remains draft-first:

- The product can create drafts.
- The product can read sent/reply state when authorized.
- The product must not send messages in MVP.

Before any send-capable feature exists:

- Gmail account must be explicit.
- Sending must require a separate confirmation boundary.
- Logs must record exact subject/body/draft/thread IDs.

## 16. Ingestion and Refresh

Current Python ingestion remains valid for MVP, but its architecture needs the phase-based,
checkpointed model described in [ingestion-architecture.md](ingestion-architecture.md). The first
Cloudflare product can import/sync from the local SQLite or from generated D1 migrations/imports.

Short-term:

- Keep `uv run jobs refresh` as the ingestion command.
- Add a D1 import/sync path.
- Product reads from D1 after sync.

Medium-term:

- Move simple board fetchers to Workers where appropriate.
- Keep complicated authenticated/headless workflows outside Workers unless they are safe and reliable there.
- Use Workers Cron for scheduled refresh where feasible.
- Use Queues for polite board fan-out.

Board-specific notes:

- ANESL: clean email route and structured fields.
- Ajarn: email route and Thailand-specific board.
- ESL Cafe modern: JSON list API plus detail pages.
- TEFL: URL apply route.
- SeriousTeachers: login-gated apply route, no exposed employer emails, manual respond form.

## 17. Authentication and Privacy

MVP can be single-user/private.

Requirements:

- No public unauthenticated dashboard.
- No identity documents in client bundle.
- Credential PDFs stay private.
- R2 may later store selected documents, but only after access controls are designed.
- Gmail OAuth tokens must not live in frontend storage.
- Local `gws-profile` can remain a development bridge, but a productized version needs proper Google OAuth.

## 18. Success Metrics

Personal MVP:

- Time from refresh to shortlist is under 10 minutes.
- User can find jobs by country/source/apply method without CLI queries.
- User can create a reviewed Gmail draft from a job.
- User can see which jobs were opened, ignored, drafted, or applied.
- No duplicate CSV exports or clutter are produced.

Product metrics later:

- Jobs reviewed per session.
- Shortlist rate.
- Draft creation rate.
- Manual application completion rate.
- Reply rate by country/source/template.
- Time from job first seen to action.

## 19. Phased Roadmap

### Phase 0: PRD and architecture

- Create this PRD.
- Decide repo layout for `apps/web`, `apps/mobile`, `packages/shared`, and `packages/api` or equivalent.
- Decide D1 migration strategy.

### Phase 1: Cloudflare web skeleton

- Scaffold React/Vite app deployed through Workers Static Assets.
- Add Worker API with D1 binding.
- Import current `jobs` schema into D1.
- Implement read-only jobs list/detail.
- Implement URL-backed filters and sorting.

### Phase 2: Application state

- Add `job_events`.
- Add save/ignore/open/mark-applied actions.
- Add event timeline in detail pane.
- Add saved filters.

### Phase 3: Search and salary normalization

- Add FTS5 table.
- Add salary parser producing min/max/currency/period/confidence.
- Add fit insights extraction.

### Phase 4: Gmail draft workflow

- Add draft preview UI.
- Add Gmail draft creation backend.
- Record draft events and Gmail IDs.
- Keep send manual.

### Phase 5: Expo mobile MVP

- Scaffold Expo Router app.
- Add NativeWind and React Native Reusables baseline.
- Use shared API types.
- Implement jobs list, detail, saved, drafts, settings.
- Add deep links to job detail.

### Phase 6: SeriousTeachers helper

- Build a browser extension or controlled helper.
- Scan visible fields.
- Review proposed values.
- Fill only after explicit user action.
- Never submit.

## 20. Risks

Board ToS and WAFs:

- Do not depend on Indeed scraping or private endpoints.
- Existing board adapters should stay polite and source-specific.

Data quality:

- Salary strings vary heavily.
- Posted dates are sparse.
- Fit insights need confidence labels.

OAuth:

- Gmail OAuth verification may be required for a public app.
- Single-user local `gws-profile` is not product-ready auth.

Mobile UI:

- Dense table workflows do not translate directly to mobile.
- NativewindUI may be helpful, but should not be assumed stable/licensed for core until checked.

Cloudflare constraints:

- D1 is a strong fit for current scale, but large text, attachments, and identity documents should move to R2.
- FTS virtual tables need careful import/export handling.

Safety:

- The system must not blur the line between prefill/draft and submit/send.

## 21. Open Questions

1. Should the product be single-user private indefinitely, or designed for multi-user from the first D1 schema?
2. Should D1 be the only job DB once the web app exists, or should local SQLite remain canonical with D1 as a mirror during MVP?
3. Which salary periods matter most for sorting: monthly, annual, hourly, per class/contact hour?
4. Should saved filters support alerts from day one?
5. Should mobile notifications exist before Gmail follow-up tracking is productized?
6. Should SeriousTeachers helper be a browser extension, Playwright-assisted local tool, or a userscript?

## 22. Current Docs Checked

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers storage options](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Cloudflare D1 SQL statements and supported SQLite extensions](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Expo Router introduction](https://docs.expo.dev/router/introduction/)
- [Expo Router API routes](https://docs.expo.dev/router/web/api-routes/)
- [Expo EAS Build](https://docs.expo.dev/build/introduction/)
- [Expo EAS Update](https://docs.expo.dev/eas-update/introduction/)
- [NativeWind v4 installation](https://www.nativewind.dev/docs/getting-started/installation)
- [NativeWind v5 installation](https://www.nativewind.dev/v5/getting-started/installation)
- [React Native Reusables](https://reactnativereusables.com/docs)
- [React Native Reusables GitHub](https://github.com/founded-labs/react-native-reusables)
- [NativewindUI](https://nativewindui.com/)
- [NativewindUI manual installation](https://nativewindui.com/installation/manual)
- [TanStack Table filtering](https://tanstack.com/table/latest/docs/guide/column-filtering)
- [TanStack Table pagination](https://tanstack.com/table/latest/docs/guide/pagination)
- [TanStack Router search params](https://tanstack.com/router/latest/docs/guide/search-params)
