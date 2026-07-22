# Jobkit Product PRD

- Status: Canonical product direction; implementation status is tracked in the application README.
- Last updated: 2026-07-20.
- Scope: ESL/teaching job discovery, qualification matching, outreach, and verified application execution.

## 1. Summary

Jobkit is an application system for international teaching work. It combines two acquisition paths:

1. normalized listings from job boards; and
1. structured country sweeps that discover schools, contacts, vacancies, and cold-outreach routes.

Both paths feed the same user-specific qualification matching, message generation, application-route execution, follow-up, and outcome tracking. The product should move safely from review to one-click and eventually policy-controlled automatic submission. Every external action must be idempotent, auditable, and verified against the authoritative destination rather than inferred from a request alone.

## 2. Why This Exists

JobKit began as a collection of local tools. The hosted product now provides the core review and application loop:

- Jobs live in `job-search/job-data/jobs.sqlite`.
- Refresh is now stateful and upserts by `(board, job_id)`.
- Country counts, board counts, salary visibility, and application channels are queryable.
- The web UI supports job selection, qualification review, immutable drafts, Gmail sending, SeriousTeachers submission, message threads, and reply state.

The inventory figures below are the dated source snapshot used to design the product. They are not live production counts.

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

| Board           | Active | Salary rows | Email rows | URL rows |
| --------------- | -----: | ----------: | ---------: | -------: |
| seriousteachers |  1,498 |       1,422 |          0 |    1,496 |
| anesl           |    502 |         502 |        502 |        0 |
| eslcafe-modern  |    439 |         366 |        351 |      178 |
| ajarn           |    159 |         136 |        159 |       24 |
| tefl            |     62 |          56 |          0 |       62 |

Top active countries:

| Country        | Jobs |
| -------------- | ---: |
| China          |  637 |
| Thailand       |  225 |
| South Korea    |  209 |
| Taiwan         |   83 |
| Italy          |   83 |
| Japan          |   80 |
| United Kingdom |   73 |
| Mexico         |   67 |
| Indonesia      |   56 |
| Hong Kong      |   53 |

Implications:

- Country filtering is already a first-class feature.
- Salary visibility is high, but salary is currently text, not normalized enough for reliable numeric sort.
- `first_seen_at` should be the primary recency field. `posted_date` is useful when present but too sparse to be the only recency source.
- Apply method should be explicit because boards differ sharply: ANESL/Ajarn are email-heavy, SeriousTeachers is form/link-heavy.

## 4. Product Goals

1. Review all active teaching jobs from one clean interface.
1. Search and filter by the things that matter: country, location, source, salary visibility, apply method, recency, status, and teaching-specific fit.
1. Sort by multiple fields, including country, first seen, salary-derived fields, source, and status.
1. Keep scraped inventory separate from application state.
1. Use one explicit, testable message policy across email, board forms, and future application routes.
1. Create Gmail drafts with the selected application packet, send when the user's automation policy permits it, and reconcile sent/reply state from Gmail.
1. Let users resolve qualification questions directly. A user-confirmed “yes” is a match; document storage is a separate convenience and submission concern.
1. Track events: viewed, saved, ignored, drafted, approved, sent/submitted, replied, interviewed, offered, rejected, bounced, and closed.
1. Support route-specific executors, beginning with Gmail and SeriousTeachers, with exact-message history, deduplication, and authoritative verification.
1. Build a reusable global catalog of schools, contacts, evidence, and freshness state from bounded country sweeps.
1. Make the web dashboard useful first, then provide a mobile client that consumes the same API and supports review, triage, and application status.

## 5. Non-Goals

- No blind submission to stale listings, duplicate recipients, or unresolved destinations.
- No unbounded cold-email blasting or shared-domain sending that damages deliverability.
- No model-only eligibility, attachment, recipient, or success decisions where deterministic state is available.
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

- Inventory is not application state, and a school is not a job.
- Qualification and proof are separate: a user's explicit “yes” resolves matching; a stored document only determines whether proof is ready to attach or upload.
- One message policy governs every channel. Platform constraints are deterministic; the model only tailors within them.
- Application routes are explicit executors: email, board form, external URL, login-gated form, phone, or manual.
- Automation is graduated from preview to one-click to policy-controlled auto-submit. Every level retains deduplication, rate limits, event history, and destination verification.
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

- TanStack Start with React and Vite for full-stack rendering and server functions.
- Cloudflare Vite plugin and Workers runtime for SSR, bindings, static assets, and deployment.
- TanStack Router for the generated typed route tree and validated URL/search state.
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

The canonical route-by-route registry is in [`docs/user-flows/`](./user-flows/README.md). This section retains the broader product acceptance criteria; the registry defines journey order, terminal states, current implementation boundaries, and roadmap linkage.

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

As the user, I can create, review, and send a Gmail application through an explicit email route.

Acceptance criteria:

- Button appears only when an email route exists or when the user manually adds an email.
- The message follows the shared message policy and is stored as an immutable version.
- The greeting is `Hello,`; `Dear` is not valid output.
- Email subjects use the proven `Native English Teacher Available - {location}` shape unless a route-specific policy overrides it.
- The selected application packet is visible before draft creation or sending.
- One explicit Send action advances the internal draft, send, and verification states.
- Gmail account/profile is explicit.
- The hosted product uses per-user Google OAuth; refresh tokens never enter frontend storage.
- Event history records exact recipient, subject, message version, attachment IDs, Gmail draft/message/thread IDs, and the executor result.
- Re-running the same route and message does not create a duplicate draft or send.
- Gmail sent/thread state is authoritative for whether email actually left the account and whether a reply arrived.

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

The private beta stores an editable candidate profile and preference set in D1. Matching evaluates each mapped requirement as `match`, `conflict`, `unknown`, or `preference` and presents both the overall state and its evidence. Hard conflicts are hidden by default but remain available through “Show ineligible”; missing data remains visible as “Needs verification.”

Initial preference controls cover countries, audiences, full-time/part-time/contract work, benefits including visa sponsorship, and minimum monthly USD. Theme is a device-local interface setting, not matching data. Profile and preference JSON documents carry explicit schema versions; migrations upgrade and persist older documents instead of transforming them on every read. The initial 14 Serious Teachers jobs use a manually reviewed criterion map; future ingestion should normalize requirements before expanding this beyond the specimen set.

Job compensation is normalized at import into amount, currency, period, qualifier, source, confidence, and notes fields. Queue and detail views consume that single stored representation; manually reviewed corrections are preserved across later imports.

Each unresolved qualification can be answered directly from the job detail view with `Yes`, `No`, or `Not sure`. `Yes` immediately resolves that criterion as a match and saves the answer to the user's qualifications for later jobs. It does not require documentary proof. The answer remains editable from Profile / Qualifications.

Documents are a parallel concern. A qualification can be satisfied without a file on the platform; the UI may recommend uploading proof so later attachment or form-upload steps are automatic. A missing file blocks execution only when the destination requires that file during the current submission, not merely because the listing mentions that the candidate may need it later.

### 10.10 Private application documents

Candidate documents live in a private R2 bucket and are indexed by D1 metadata. Objects are never published as static assets. All upload, listing, view, and delete requests require the same private beta authorization as the rest of the API. Authenticated reads stream object bodies with private, no-store caching so the same files can later be attached to outbound email workflows.

Email packets select specific document versions rather than attaching every file in a category. Initial presets:

- `English teaching core`: default resume, degree/diploma, and TEFL certificate.
- `Visa-market`: core packet plus passport and recent professional photo.
- `Requested proof`: only documents explicitly required by the destination, such as a background check, transcript, teaching credential, or reference letter.

Packet presets are recommendations and user-editable. The personal profile may choose `Visa-market` as its normal packet. The product must not claim a file is attached unless the exact immutable draft records that attachment and the Gmail MIME payload contains it.

### 10.11 Message policy and preference calibration

Every generated message is constrained by a platform policy before user-specific style is applied:

- greet with `Hello,`; never generate `Dear`;
- write in the candidate's first-person voice;
- lead with truthful qualifications and availability relevant to the route;
- stay concise and specific without copying listing boilerplate;
- ask exactly one useful question that invites a reply;
- never invent qualifications, duration, relocation intent, authorization, or document availability;
- use the profile-selected signature; and
- pass deterministic validation before approval or automatic execution.

Style calibration presents two outputs for the same context and lets the user choose A, B, or equal. Decisions can focus on a whole message or one changed sentence. Each decision stores the context, both variants, the chosen variant, optional reason tags, models/prompts, and timestamp. The selected examples become an editable style instruction plus a compact few-shot example set; this is prompt and evaluation data, not an RL-training requirement.

The same calibration set evaluates candidate models and prompt revisions. Human pairwise choices are ground truth; deterministic rules score hard constraints; model judges may assist with soft rubrics only after they are calibrated against those human choices.

### 10.12 School catalog and country sweeps

Country sweeps populate a global catalog, not user-specific fake jobs. The catalog stores schools, locations, domains, multiple contact points, evidence URLs, last-verified dates, career pages, and outreach eligibility. Active opportunities reference schools but remain distinct records.

A bounded sweep has three phases:

1. discovery across directories, search, maps, and known sources;
1. verification of the official site, contacts, vacancies, and evidence; and
1. a coverage audit for missed cities, school types, and duplicates.

The persisted result is reusable by every user. Applications, replies, and outcomes remain user-owned; later aggregate response metrics must preserve user privacy.

### 10.13 Policy-controlled execution

Each user chooses an automation level per channel: preview only, one-click approve/send, or auto-submit. Auto-submit is allowed only when the route is fresh, the recipient is valid, hard requirements are not declined, any required-at-submission files are attached, message validation passes, deduplication passes, and daily/channel limits permit the action. Otherwise the item returns to review with a specific reason.

Non-response belongs to an outreach attempt, not permanently to the school. School/contact response rates are computed only after a defined response window and sufficient attempts; the initial display threshold is at least three independent sends.

Country campaigns operate as paced searches rather than fixed item batches. A campaign exposes all currently eligible advertised opportunities and verified school contacts. It calibrates the first five messages, then executes at the user's configured daily pace until the pool is exhausted, the user stops it, or three person-authored replies pause it by default. Bounces, delivery failures, vacation responders, and automated acknowledgements do not count toward that reply threshold. Provider quotas and measured delivery backpressure may slow execution, but they do not truncate the eligible pool or create an unsupported product-level target cap.

Campaigns may overlap in country and source inventory. Before execution, JobKit atomically claims the opportunity or canonical contact channel for that user. A verified send suppresses the same execution in every other campaign. Intermediary routes are composed automatically: for ANESL, JobKit ranks eligible references in the campaign markets and sends one instruction-compliant email covering the strongest one to five positions instead of requiring a separate ANESL workspace.

## 11. Data Model

The hosted `job_listings` table is the global opportunity inventory root. `user_listing_states` stores each user's workflow status and priority for a listing. Schools, contacts, qualification claims, application routes, messages, attempts, and events remain separate entities rather than extra columns forced onto a listing row.

### 11.1 Job listings

The local ingestion inventory is keyed by:

```sql
PRIMARY KEY (board, job_id)
```

The hosted D1 table uses an unambiguous `job_listings.id`, normally `${board}:${job_id}` for board inventory. The board and source reference remain explicit fields because separate boards can emit the same native identifier.

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

Application destinations belong in a related table because one opportunity may expose email, URL, board-form, phone, and manual routes simultaneously:

```sql
CREATE TABLE application_routes (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('email','board_form','external_url','login_gated_form','phone','manual')),
    destination TEXT NOT NULL,
    contact_point_id TEXT,
    source_evidence TEXT NOT NULL DEFAULT '',
    last_verified_at TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','closed','invalid')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

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

### 11.7 User-confirmed qualifications

User answers are first-class matching inputs, not document-verification records:

```sql
CREATE TABLE user_qualification_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    concept_key TEXT NOT NULL,
    answer TEXT NOT NULL CHECK (answer IN ('yes','no')),
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, kind, concept_key)
);
```

The matcher checks an exact normalized claim before falling back to structured profile fields and documents. `yes` resolves the requirement to `match`; `no` resolves a required criterion to `conflict`; deleting the answer restores `unknown`. Reuse is allowed only when the normalized concept is genuinely equivalent—for example, `document:grade_transcript` must not resolve an unrelated transcript or degree requirement.

### 11.8 Document packets

```sql
CREATE TABLE user_document_packets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, name)
);

CREATE TABLE user_document_packet_items (
    packet_id TEXT NOT NULL REFERENCES user_document_packets(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES user_documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (packet_id, document_id)
);
```

An application draft snapshots the selected document IDs so changing a packet later cannot change what an approved or sent draft claims to contain.

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

Gmail supports preview, draft, explicit send, and policy-controlled automatic send. Drafting and sending remain separate executor actions even when automation advances directly from one to the other.

- The hosted product uses per-user Google OAuth and the Gmail compose/read scopes required for verified sends and reply sync.
- MIME messages include the exact selected document versions; text that claims attachments must be rejected if the MIME payload does not contain them.
- Gmail is authoritative for sent state, thread membership, replies, bounces, and delivery-adjacent signals available through the API.
- Logs record exact recipient, subject, message version, attachment IDs, draft/message/thread IDs, executor, automation policy, and result.
- Per-user rate limits, deduplication, suppression, and pause controls apply before every send.

## 16. Ingestion and Refresh

The JobKit-owned Go collector under `collectors/` is the canonical source-ingestion implementation. It writes source records to the local SQLite inventory with phase-based checkpoints, then the hosted runner publishes an immutable snapshot to D1.

Short-term:

- Use `jobkit-collect refresh <board>` as the source-ingestion command.
- Refresh and reconcile a source before importing its active rows; do not bulk-import the existing SQLite snapshot as if every listing were current.
- Add a D1 import/sync path that preserves source freshness and closure evidence.
- Product reads from D1 after sync.
- Normalize one or more application routes per opportunity instead of overloading a single URL.

Medium-term:

- Keep source collectors outside Workers while their complete-source and authenticated contracts depend on local execution.
- Use Workers Cron for scheduled refresh where feasible.
- Keep requests sequential inside a source unless that source explicitly documents safe concurrency.

Board-specific notes:

- ANESL: clean email route and structured fields.
- Ajarn: email route and Thailand-specific board.
- ESL Cafe modern: JSON list API plus detail pages.
- TEFL: URL apply route.
- SeriousTeachers: login-gated apply route, no exposed employer emails, manual respond form.
- Country sweeps: school/contact discovery and verification, not job-board rows.

## 17. Authentication and Privacy

Public discovery and private candidate work use separate data boundaries.

Requirements:

- Public visitors may browse published job and market pages without authentication.
- Applying, profile match, campaigns, messages, documents, drafts, recipients, and execution state require authentication.
- No identity documents in client bundle.
- Credential PDFs stay private.
- R2 may later store selected documents, but only after access controls are designed.
- Gmail OAuth tokens must not live in frontend storage.
- Gmail execution uses hosted per-user Google OAuth in every environment.

## 18. Success Metrics

Personal MVP:

- Time from refresh to shortlist is under 10 minutes.
- User can find jobs by country/source/apply method without CLI queries.
- User can create a reviewed Gmail draft with the correct attachment packet from a job.
- User can confirm a qualification once and reuse it across future matches.
- User can send or submit through a supported executor and see authoritative verification.
- User can see which jobs were opened, ignored, drafted, or applied.
- No duplicate CSV exports or clutter are produced.

Product metrics later:

- Jobs reviewed per session.
- Shortlist rate.
- Draft creation rate.
- Manual application completion rate.
- Reply rate by country/source/template.
- Delivery, reply, interview, and offer rates by route, contact, school, country, and message policy.
- Automatic-execution hold rate and reason distribution.
- Time from job first seen to action.

## 19. Phased Roadmap

### Phase 1: Current private beta — complete the application core

- Enforce one shared message policy in the hosted generator and local email path.
- Add reversible user-confirmed qualification resolutions.
- Add document packet selection and real Gmail MIME attachments.
- Keep the existing SeriousTeachers executor idempotent and authoritative.
- Build the 10–20 item pairwise message calibration flow and model comparison dataset.

### Phase 2: Fresh multi-source inventory and email execution

- Refresh each existing board and import only reconciled active rows into D1.
- Add normalized application routes, including multiple emails or URLs when supported.
- Connect Gmail through hosted per-user Google OAuth for personal dogfooding and later users.
- Reconcile drafts, sends, replies, bounces, interviews, offers, and rejections.

### Phase 3: School catalog and country sweeps

- Add organizations, locations, contact points, evidence, and discovery-run state.
- Import the recovered May 11 workbook from `job-search/job-data/country-sweeps/tajikistan/2026-05-11/` as the first persisted sweep, keeping dated vacancies separate from school-level outreach targets.
- Run Georgia as the second market and use the coverage comparison to refine the workflow.
- Add freshness scheduling and deduplication by canonical domain, organization, and location.

### Phase 4: Controlled automation

- Add per-user/channel automation policies, daily limits, suppression, and pause controls.
- Auto-submit only the safe subset; hold anything with a specific unresolved execution condition.
- Measure delivery, reply, interview, and offer outcomes by route and message policy.
- Permit model or prompt changes only when they pass the human-labeled calibration set.

### Phase 5: Additional executors and mobile

- Investigate TEFL.com login and application automation after credentials and destination behavior are verified.
- Add other board/ATS executors only when they can be made idempotent and observable.
- Build the mobile client around triage, confirmations, approvals, and outcome notifications after the web application flow is stable.

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

- The system must record the exact transition from preview to draft to send/submit.
- User-confirmed qualifications are sufficient for matching; the platform must not represent them as independently verified credentials.
- Official document contents and dates are never altered by the platform.
- Automation must be pausable, rate-limited, deduplicated, and scoped per user and channel.

## 21. Open Questions

1. Which document packet should be the personal default: `English teaching core` or `Visa-market`?
1. Which Gmail actions should the first hosted OAuth consent request: compose only, or compose and send?
1. What route-specific daily send limits should apply during personal dogfooding?
1. Which salary periods matter most for sorting: monthly, annual, hourly, or per contact hour?
1. Should saved filters support alerts before country-sweep freshness notifications exist?

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
- [Anthropic custom styles from writing samples and instructions](https://support.anthropic.com/en/articles/10181068-configuring-and-using-styles)
- [LangSmith pairwise annotation queues](https://docs.langchain.com/langsmith/annotation-queues)
- [Google Gemini prompt design and few-shot examples](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- [Google Vertex AI pairwise evaluation against human preferences](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluate-judge-model)
