# JobKit product contract

This file records JobKit's stable product shape and the boundaries that every implementation slice must preserve. The user-flow registry defines each journey in detail, and `TODO.md` tracks unfinished work in dependency order.

## Product outcome

JobKit helps a candidate find real teaching opportunities, understand fit and application requirements, apply through the correct route, and track replies. A candidate can use the guided workspace one application at a time or authorize a paced country campaign after reviewing its first messages.

The product earns trust through source provenance, freshness, canonical employer and location identity, normalized compensation, duplicate detection, evidence-backed eligibility, route clarity, and authoritative application outcomes.

## Access modes

| Mode                | Available experience                                                              | Data boundary                                                         |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Public visitor      | Browse active jobs and supported market pages; read a complete canonical job page | Public job and organization facts only                                |
| Signed-in candidate | Review profile match, documents, application routes, campaigns, and messages      | Candidate-owned profile, documents, drafts, attempts, and Gmail state |
| Operator            | Inspect ingestion, analysis, task execution, and data-quality failures            | Role-gated operational state                                          |

Public pages never expose recipient email addresses, private board credentials, candidate facts, documents, drafts, or execution records. A public Apply action preserves the selected job while sign-in and onboarding complete, then opens the authenticated application flow.

## Product surfaces

### Public discovery

- `/` is the public product and discovery entry.
- `/jobs` is the public browse index.
- `/jobs/:countrySlug` is the single country route family.
- `/jobs/:countrySlug/:citySlug` is the single city route family.
- `/job/:publicId/:slug` is the canonical page for one advertised position.
- `/methodology`, `/corrections`, `/privacy`, and `/terms` establish trust, correction, and legal policy.
- Query-string search and filters remain useful browse state. Explicit published routes own indexable landing pages.

Employer dossiers, proprietary data reports, and sourced guides may later use `/employers/*`, `/data/*`, and `/guides/*` after their own publication gates succeed.

The durable `publicId` owns identity. The slug is descriptive presentation. A stale slug redirects permanently to the current canonical URL.

### Authenticated workspace

- `/app/jobs` is the manual review and application workspace.
- `/app/campaigns` contains campaign list, setup, detail, and nested Markets.
- `/app/messages` contains application conversations and outcomes.
- `/app/settings` contains profile, preferences, documents, writing style, automation, and account settings.
- `/app/operator` contains gated inventory, task, and diagnostic controls.

Campaigns, Jobs, and Messages are the primary candidate navigation. Markets remains inside Campaigns. Settings remains in the account surface. Operator tools remain outside candidate navigation.

The authenticated workspace and its filter URLs are private and `noindex`. A signed-in candidate may open a public job page; personalized match and application controls load as a private client-side enhancement over public, cache-safe HTML.

## Rendering decision

Public discovery and the authenticated application use TanStack Start with TanStack Router on the Cloudflare Worker. TanStack Start supplies server-side rendering, server loaders and functions, and the Cloudflare server entry; TanStack Router supplies the typed route tree, path parameters, validated search state, and navigation. Dynamic D1-backed job pages require current HTML, accurate HTTP status codes, canonical metadata, and structured data in the first response. Cloudflare and TanStack both publish supported TanStack Start deployment paths for Workers.

The application now uses one generated TanStack Start route tree. A custom Start server entry sends `/api/*`, webhooks, and OpenAPI requests through the existing Hono application, preserves scheduled Worker handlers, and sends document and server-function requests through TanStack Start. `AuthGate` owns the private `/app/*` layout, while public foundation routes render server-side and remain `noindex` until their canonical data and publication slices are complete.

Public HTML and caches contain public facts only. Authentication hydrates candidate-specific match and action state after the public document loads. Personalized responses use private cache policy.

Public responses use a public-content version for `ETag`, `Last-Modified`, and cache invalidation. Authenticated HTML and APIs use private, no-store policy.

## Shared data contract

Every surface distinguishes four layers:

| Layer             | Ownership              | Examples                                                                 |
| ----------------- | ---------------------- | ------------------------------------------------------------------------ |
| Source record     | Collector or Gmail     | Literal listing text, source URL, received message                       |
| Canonical record  | JobKit                 | Employer identity, Mapbox-backed location, compensation, position, route |
| Analysis snapshot | Versioned Codex result | Structured description, requirements, fit evidence, position variants    |
| Execution record  | Candidate workflow     | Draft version, attachment packet, attempt, send, reply, campaign event   |

A source hash changes only when material source content changes. Verification timestamps update freshness without invalidating a current analysis snapshot. Public metadata and sitemap `lastmod` use material-change time rather than crawl time.

The public entity layer consolidates duplicate source listings and separates an advertised source record from each evidence-backed position it contains. It records a durable public ID, canonical entity, source mappings, original posting date, source expiry, public content hash and update time, verification time, publication state, organic-index eligibility, `JobPosting` eligibility, and a reason for every eligibility decision.

### Public job eligibility

One public job page represents one genuine advertised position. It becomes eligible for public browsing when JobKit has:

- a current open-state signal;
- a stable source and provenance record;
- a canonical title, organization, and location or valid remote-applicant geography;
- a complete fact-preserving description;
- a valid application route; and
- permission under the source policy to publish the selected fields.

Organic index eligibility additionally requires a unique canonical entity, current public content, and useful provenance. `JobPosting` eligibility additionally requires one concrete current job, the employer's original `datePosted`, a complete visible description, verified location or remote-applicant geography, and every required structured field.

A multi-position source listing produces separate public position pages after each position has evidence-backed facts and a valid shared or individual application route. Until then, the listing remains inside the authenticated workspace. School contacts discovered for cold outreach remain organization records.

### Public description

The public description is a complete JobKit-authored presentation of verified source facts. Its standard sections are Overview, Responsibilities, Qualifications, Teaching context, Schedule and contract, Compensation and benefits, Location and visa, Application process, and Additional details. Empty sections disappear. The source record remains immutable, and each normalized description records its source hash, model or deterministic producer, version, evidence, and review state.

The normalized description improves readability and adds JobKit's structured value. Every public claim carries source evidence, provenance remains visible, and wording follows reader meaning rather than keyword repetition.

## Search contract

### Job pages

A `JobPosting`-eligible page renders one accurate JSON-LD object in the initial HTML. The visible page and structured data agree on title, organization, location, description, dates, compensation, employment type, and application availability. `JobPosting` markup appears only on the single-position detail page. Stated source compensation supplies `baseSalary`; JobKit's derived USD hourly comparison remains visible product data outside JSON-LD. JobKit omits `directApply` until the measured application flow satisfies Google's direct-apply definition.

Each canonical job page includes a self-canonical absolute URL, unique title and description, crawlable internal links, a visible closed state when applicable, and breadcrumb context. Active canonical pages enter the job sitemap with accurate material-change timestamps. New, changed, and removed job URLs also produce Google Indexing API events.

When a position closes, JobKit removes it from active browse results and the active sitemap, removes live `JobPosting` markup, and sends the removal event. A retained provenance page clearly states that the role closed and uses `noindex`; a page without durable public value returns `410 Gone`.

### Programmatic market pages

Country and city pages become indexable through an explicit publishing decision backed by current inventory, canonical geography, unique proprietary facts, and useful navigation. A page qualifies through evidence and completeness rather than an arbitrary URL or inventory quota. Empty, duplicate, stale, or template-only pages remain unpublished or `noindex`.

Indexable market pages may use active-job counts, salary distributions with disclosed sample context, eligibility patterns, source coverage, freshness, application friction, and employer history. Market publication requires proprietary hiring data; generic travel or visa prose alone leaves the page unpublished. High-stakes visa guidance cites current official sources and records its review date.

The versioned market publishing policy records each decision and reason. This provides an auditable rule instead of an inline magic number.

### Canonical and crawl policy

One intent has one canonical route. Redirects, self-canonical tags, internal links, and sitemap entries all select the same URL. Public filter combinations, search results, authenticated routes, preview fixtures, and operator routes stay out of sitemaps and search indexes.

## Working method

Each product slice passes through three distinct owners:

1. A research and contract owner verifies current behavior, authoritative references, data requirements, responsive states, and acceptance criteria.
1. An implementation owner makes the smallest complete vertical slice across schema, Worker, React, and tests.
1. An independent verification owner proves the slice against production-shaped records and the written contract.

A slice closes only with API and database evidence, loading/error/empty/success behavior, URL and Back behavior, keyboard and focus behavior, screenshots at phone, iPad portrait, iPad landscape, desktop, and 200% zoom, plus an end-to-end journey. Fixture screenshots establish layout evidence; production readiness requires production-shaped journey proof.

## Evidence basis

- [ESL Gorilla competitive SEO audit](docs/research/esl-gorilla-seo-audit-2026-07-20.md)
- [Google JobPosting structured-data requirements](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google spam policies for doorway and scaled content](https://developers.google.com/search/docs/essentials/spam-policies)
- [TanStack Router migration from React Router](https://tanstack.com/router/latest/docs/how-to/migrate-from-react-router)
- [TanStack Start hosting on Cloudflare Workers](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Cloudflare TanStack Start framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)

## Documentation authority

1. `PRODUCT.md` owns the stable product, access, route, rendering, and shared-data contract.
1. `docs/user-flows/` owns journey order, decisions, state transitions, and terminal states.
1. `docs/jobkit-product-prd.md` retains detailed requirements and historical design context.
1. `TODO.md` owns unfinished, dependency-ordered work.
1. Browser and Worker tests prove only the behavior they execute.
