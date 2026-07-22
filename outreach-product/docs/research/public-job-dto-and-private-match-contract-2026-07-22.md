# Public job DTO and private match contract

Contract date: 2026-07-22

**Contract amendment:** `public-job-dto-v2`, 2026-07-22

This document is the canonical research contract for `PUBLIC-DTO-001`. It fixes the anonymous public list and detail representations, the signed-in match adapter boundary, repository read allowlists, HTTP behavior, and production-shaped acceptance evidence. [`PRODUCT.md`](../../PRODUCT.md) remains authoritative for the product and route families. The [identity and location contract](public-projection-identity-location-contract-2026-07-22.md) remains authoritative for entity, organization, and location resolution. The [source publication policy audit](source-publication-policies-2026-07-21.md) remains authoritative for source reuse.

The current public routes are foundation placeholders. Migration 0048 provides the fail-closed entity and policy foundation, while this contract supplies the exact read boundary an implementation slice must add. The initial source policies publish zero jobs, so production data enters these DTOs only after a new approved and enabled policy version permits every selected source field.

The v2 amendment fixes the canonical leaf route as `/job/:publicId/:slug`, adds one catalog temporal snapshot identity to list DTOs, cursors, validators, seals, sitemap reads, and `JobPosting` reads, and promotes the attribute-free public description output to `public-description-v2`. The internal authored-description builder may use `public-description-builder-v3`; its public renderer emits the exact v2 output schema and canonical bytes defined here. Hashing and canonical DTO JSON bytes use `public-job-json-bytes-v2` plus the registry formulas in the [candidate core](public-projection-candidate-core-contract-2026-07-22.md).

## Module boundaries

This DTO contract owns transport, SSR, strict serialization, public repository read allowlists, HTTP status behavior, cache validators, and the private match adapter. Storage and activation authority is delegated as follows:

- [Application authority](public-application-authority-contract-2026-07-22.md) owns canonical route state, aliases, application availability, and private destination facts.
- [Catalog and temporal authority](public-catalog-temporal-contract-2026-07-22.md) owns active and tombstone membership, current catalog pointers, temporal snapshots, policy activation, emergency revocation, and expiry cutovers.
- [Promotion activation](public-promotion-activation-contract-2026-07-22.md) owns destination-row compilation and live head advancement.
- [Candidate core](public-projection-candidate-core-contract-2026-07-22.md) owns private facts, current-policy field decisions, and the sealed authored-description input.

Sections below define the read interface to those owners. Their write schemas, transactions, leases, and activation mechanics remain normative in their owning module only.

## Decisions

1. TanStack Start route loaders own anonymous public reads and server-rendered HTML. They receive D1 through typed request context and serialize the exact DTOs in this document.
1. The first implementation exposes no anonymous `/api/*` route. A later public JSON endpoint must call the same repository and return the same DTO schema.
1. Public SSR is session-independent. Signed-in match state hydrates through a separate private server function after the public document loads.
1. D1 public views and repository serializers form a two-stage allowlist. The views establish eligibility, and strict serializers select exact public keys from every nested JSON value.
1. Public list pagination uses an integrity-protected keyset cursor. A cursor is bound to the normalized query and one exact catalog temporal snapshot identity.
1. Public cache validators derive from immutable public content and eligibility versions. Candidate state always uses a private cache policy.

## Current foundation evidence

| Evidence                                                                            | Contract significance                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Migration 0048](../../migrations/0048_public_job_entities.sql)                     | Defines policy versions and heads, canonical public entities, immutable content and eligibility versions, decision-source field declarations, current public views, aliases, redirects, and explicit gone routes |
| [Migration 0049](../../migrations/0049_public_projection_runs.sql)                  | Defines shadow projection runs and artifacts; these operator records grant no public read authority                                                                                                              |
| [Migration 0050](../../migrations/0050_job_listing_version_immutability.sql)        | Makes listing material versions immutable so a public decision can pin stable source input                                                                                                                       |
| [Migration 0051](../../migrations/0051_public_projection_duplicate_comparisons.sql) | Defines duplicate-comparison work and evidence; every comparison artifact remains operator-only and outside anonymous DTOs                                                                                       |
| [Current public description builder](../../src/features/public/description.ts)      | Supplies the foundation escaped text, element allowlist, and contact-value removal that `public-description-v2` retains                                                                                          |
| [Current Worker route policy](../../src/server-routing.ts)                          | Supplies the existing public-document and private-response cache split                                                                                                                                           |
| [Current private Jobs route](../../worker/routes/jobs.ts)                           | Demonstrates why candidate match, contacts, destinations, drafts, and attempts require a separate private adapter                                                                                                |
| [Public discovery flow](../user-flows/public-discovery.md)                          | Requires first-response SSR, canonical lifecycle statuses, public/private cache separation, and sign-in return to the selected job                                                                               |

The current public list route renders a foundation state, and the country, city, and detail routes resolve to missing responses. The implementation slice therefore connects new public repositories and loaders rather than adapting the private Jobs API.

## Transport and rendering boundary

The public repository is available only to the TanStack Start server runtime. The route loaders for `/jobs`, published market routes, and `/job/:publicId/:slug` call that repository. TanStack Start performs SSR by default, and loader data becomes part of the first HTML response. TanStack's [server entry point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point) supports typed request context, and its [server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) keep server implementations out of the client bundle.

The Worker request context supplies one D1 binding to the public repository. The browser bundle receives DTO values only. It receives no D1 binding, SQL, source row, route destination, or server implementation.

Public routes preserve these response boundaries:

| Response surface                  | Session read | Cache policy                           | Personalized data |
| --------------------------------- | ------------ | -------------------------------------- | ----------------- |
| Public HTML and serialized loader | Absent       | `public, max-age=0, must-revalidate`   | Absent            |
| Private match server function     | Required     | `private, no-store` and `Vary: Cookie` | Present           |
| Authenticated `/app/*` HTML/API   | Required     | `private, no-store`                    | Present           |

An authenticated cookie produces the same public HTML bytes and public cache validators as an anonymous request. The client requests the private match only after hydration. Public responses omit `Set-Cookie` and omit `Cookie` from `Vary`.

## D1 read allowlist

### Public relations

The public repository may read only the following public relations with an explicit column list:

| Relation                       | Ownership                                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public_job_route_resolutions` | Requested alias, `serve`, permanent redirect, or explicit gone result                                                                                                                               |
| `public_job_route_content`     | One strict public detail projection for an active or retained closed canonical job                                                                                                                  |
| `public_browse_jobs`           | Active browse membership and the public card facts selected by a list query                                                                                                                         |
| `organic_index_jobs`           | SEO eligibility only; it never broadens the DTO                                                                                                                                                     |
| `job_posting_jobs`             | `JobPosting` eligibility only; it never broadens the DTO                                                                                                                                            |
| `public_browse_job_locations`  | Required indexed country and locality facets for list and market queries                                                                                                                            |
| `public_job_search_index`      | Required versioned search document and relevance rank for `q`                                                                                                                                       |
| `public_job_catalog_head`      | Read view over `public_job_catalog_head_pointer`; supplies catalog version, temporal snapshot identity, membership hash, representation update time, material update time, and search index version |

The catalog contract owns the canonical write table `public_job_catalog_head_pointer`, immutable `public_job_catalog_head_history`, and read view `public_job_catalog_head`. A successor migration extends those exact relations and preserves this vocabulary. The storage form of later search support may be a table, view, or D1-supported search index, while this contract fixes the repository output semantics.

The detail query resolves the alias first and selects content only for a `serve` action. A permanent redirect uses only the target path from the route resolution relation. A gone response uses only the route action. The list query selects card columns from `public_browse_jobs`, joins the location facet relation for market filters, and joins the search relation only when `q` is present or relevance ordering is active.

Every query uses D1 prepared statements and index-backed predicates. D1 follows SQLite query semantics and supports prepared statements, as documented in [Query a database](https://developers.cloudflare.com/d1/best-practices/query-d1/). List queries fetch `limit + 1` rows to establish `hasMore`. They use keyset predicates and never use `OFFSET`.

The private match adapter uses a separate authenticated repository. That repository may read the candidate's profile and versioned analysis facts. It receives `publicId` and `publicJobVersion`, resolves the pinned canonical source position behind that public version, and returns only the private adapter DTO. Public repositories never join user, profile, document, draft, attempt, campaign, contact, application destination, credential, or Gmail tables.

### Required successor projection

The current `public_job_route_content` view validates current source mappings and policies, then emits every content column. The exact DTO requires a successor migration with these additions:

- `public_job_version` in `public_browse_jobs`;
- the current eligibility `decision_hash` and representation update time for detail validators;
- field-by-field source-policy suppression before serialization;
- the complete safe location snapshot, including role, scope, coordinates, coordinate kind, and bounds;
- a stable public source label rather than a raw `source_key`;
- a catalog head and indexed browse facets; and
- a versioned public search relation.

The serializer still validates every selected value. SQL eligibility and TypeScript validation form complementary gates.

## Field publication rule

A source-backed field is effective when at least one current `public_content` decision source names the field in `fields_used_json`, the same field appears in that source's current policy `allowed_fields_json`, and the current policy remains approved, enabled, and broader than `blocked`. Every contributing source mapping and listing material version must remain current.

The public projection applies these exact outcomes:

| DTO fact                            | Policy field          | Outcome when unavailable or disallowed                                            |
| ----------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Title                               | `title`               | Suppress the whole job                                                            |
| Organization name                   | `organization_name`   | Suppress the whole job                                                            |
| Workplace type and locations        | `locations`           | Suppress the whole job                                                            |
| Complete normalized description     | `description`         | Suppress the whole job                                                            |
| Posted date                         | `date_posted`         | Return `null`                                                                     |
| Expiry date                         | `valid_through`       | Return `null`                                                                     |
| Employment types                    | `employment_types`    | Return `[]`                                                                       |
| Stated and derived compensation     | `compensation`        | Return `null`                                                                     |
| Source display name                 | `source_name`         | Omit that source name                                                             |
| Source link                         | `source_url`          | Omit that source link                                                             |
| Durable ID, slug, status, freshness | JobKit-derived state  | Publish only after the required source-backed fields pass                         |
| Application availability            | JobKit route decision | Publish the Boolean only; retain every route and destination fact in private data |

`workplaceType`, canonical location components, and route slugs are derived from policy-approved source facts. Derived USD hourly compensation inherits the `compensation` permission. JobKit's authored description inherits the `description` permission even when its wording is original.

A public workplace type resolves to `onsite`, `hybrid`, or `remote`; `unknown` suppresses the job. Organization websites stay outside DTO version 1 because the current source-policy field vocabulary provides no website permission.

Every JSON column receives a strict schema parse after policy suppression. Unknown object keys are discarded. Invalid allowed data suppresses the job from the list and produces `404` on its detail route. Suppressed optional data is skipped before parsing and returns its documented null or empty value. Raw JSON strings are never forwarded to a browser.

## Shared public value types

All object schemas are strict, and every listed key is present unless its type says otherwise. Timestamps use UTC RFC 3339 with a trailing `Z`, while calendar dates use `YYYY-MM-DD`. Numeric amounts are finite JSON numbers, currencies use uppercase ISO 4217 codes, and countries use uppercase ISO 3166-1 alpha-2 codes.

```ts
type PublicWorkplaceTypeV1 = "onsite" | "hybrid" | "remote";

type PublicEmploymentTypeV1 = "fullTime" | "partTime" | "contract";

type PublicSourceDateV1 = {
  value: string;
  provenance: "employer-original" | "board-published";
};

type PublicLocationV1 = {
  role: "worksite" | "applicantArea";
  scope: "address" | "locality" | "region" | "countrywide";
  displayName: string;
  countryCode: string;
  region: string | null;
  locality: string | null;
  postalCode: string | null;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  coordinateKind: "point" | "centroid";
  bounds: [west: number, south: number, east: number, north: number] | null;
};

type PublicCompensationAmountV1 = {
  minimum: number | null;
  maximum: number | null;
  currency: string;
  period:
    | "hour"
    | "day"
    | "week"
    | "fortnight"
    | "month"
    | "year"
    | "contract";
  qualifier: "exact" | "range" | "up-to" | "from" | null;
  taxBasis: "gross" | "net" | "unspecified";
};

type PublicHourlyUsdV1 = {
  minimum: number | null;
  maximum: number | null;
  basis: "listed" | "onsite" | "teaching" | "teaching-plus-office";
  taxBasis: "gross" | "net" | "unspecified";
  fxAsOf: string;
};

type PublicCompensationV1 = {
  kind: "amount" | "conflict" | "negotiable" | "unstated";
  amount: PublicCompensationAmountV1 | null;
  hourlyUsd: PublicHourlyUsdV1 | null;
};

type PublicSourceAttributionV1 = {
  name: string | null;
  url: string | null;
};

type PublicJobFreshnessV1 = {
  materialChangedAt: string;
  verifiedAt: string;
};

type PublicApplicationAvailabilityV1 = {
  available: boolean;
};
```

The location array uses the ordering from the identity and location contract. It contains resolved snapshots only. A location has a nonempty `displayName`, a country, and coordinates. A bound contains west, south, east, and north in that order. Longitude stays within `-180..180`; latitude stays within `-90..90`.

Every `publicId` matches `pjob_v1_[0-9a-f]{64}` and every public version is a positive integer. `canonicalPath` is `/job/{publicId}/{canonicalSlug}` and contains the same ID and slug as its sibling fields.

An `amount` compensation has at least one numeric bound, a currency, and a pay period. The other compensation kinds have `amount: null`. `hourlyUsd` appears only when one version-pinned source compensation, workload denominator, and FX snapshot support it. Evidence strings, workload evidence, and FX provider responses remain private. The derived value appears in visible product content and stays outside Google `JobPosting` JSON-LD.

Source attributions are deduplicated and bytewise sorted by name and URL. Each object has at least one non-null value. `attribution_mode=none` emits no object; `source_name` permits an allowed name; and `source_link` permits an allowed name and link. Each URL uses `https`, excludes user information and fragments, and passes the source policy's approved URL rule. The public label comes from a versioned JobKit source-label mapping rather than the internal source key.

## Anonymous list DTO

`/jobs` and every published market list serialize this exact success schema:

```ts
type PublicJobListItemV1 = {
  publicId: string;
  publicJobVersion: number;
  canonicalSlug: string;
  canonicalPath: string;
  status: "active";
  title: string;
  organization: {
    name: string;
  };
  workplaceType: PublicWorkplaceTypeV1;
  locations: PublicLocationV1[];
  datePosted: PublicSourceDateV1 | null;
  validThrough: PublicSourceDateV1 | null;
  employmentTypes: PublicEmploymentTypeV1[];
  compensation: PublicCompensationV1 | null;
  sources: PublicSourceAttributionV1[];
  freshness: PublicJobFreshnessV1;
  application: PublicApplicationAvailabilityV1;
};

type PublicJobListResponseV2 = {
  schemaVersion: "public-job-list-v2";
  scope:
    | { kind: "global" }
    | { kind: "country"; countryCode: string; countrySlug: string }
    | {
        kind: "city";
        countryCode: string;
        countrySlug: string;
        citySlug: string;
        displayName: string;
      };
  query: {
    q: string | null;
    country: string | null;
    workplace: PublicWorkplaceTypeV1 | null;
    employmentType: PublicEmploymentTypeV1 | null;
    compensation: "stated" | "negotiable" | null;
    sort: "relevance" | "recent" | "hourlyUsd" | "title";
    limit: number;
  };
  catalog: {
    version: string;
    temporalSnapshotId: string;
    materialChangedAt: string;
    searchIndexVersion: string;
  };
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  };
  items: PublicJobListItemV1[];
};
```

The list item omits `descriptionHtml`. It gives the card and screen reader every fact needed to identify the role, employer, location, compensation, freshness, and application availability. A list response contains active browse-eligible jobs only, so `application.available` is `true` under the current publication gate.

An empty valid query returns `200` with `items: []`, `hasMore: false`, and a null cursor. A temporary D1 or repository failure returns a truthful `5xx` response and a server-rendered retry state instead of this success schema.

## Anonymous detail DTO

The canonical detail route serializes this exact success schema:

```ts
type PublicJobDetailResponseV2 = {
  schemaVersion: "public-job-detail-v2";
  catalogTemporalSnapshotId: string;
  publicId: string;
  publicJobVersion: number;
  canonicalSlug: string;
  canonicalPath: string;
  status: "active" | "closed";
  title: string;
  organization: {
    name: string;
  };
  workplaceType: PublicWorkplaceTypeV1;
  locations: PublicLocationV1[];
  datePosted: PublicSourceDateV1 | null;
  validThrough: PublicSourceDateV1 | null;
  employmentTypes: PublicEmploymentTypeV1[];
  compensation: PublicCompensationV1 | null;
  descriptionHtml: string;
  sources: PublicSourceAttributionV1[];
  freshness: PublicJobFreshnessV1;
  application: PublicApplicationAvailabilityV1;
};
```

`descriptionHtml` follows `public-description-v2`. Its element allowlist is `section`, `h2`, `p`, `ul`, and `li`; attributes are absent. Each section renders as `<section>`, one `<h2>`, zero or more `<p>` elements, and at most one `<ul>` containing `<li>` elements. Text escapes `&`, `<`, `>`, `"`, and `'` to `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` in that order. Elements and sections join with one LF and the output has zero leading or trailing whitespace. The description contains no email address, URL, phone number, `mailto:`, or `tel:` value. The serializer parses and sanitizes stored HTML against this allowlist before returning it.

The canonical DTO byte serializer is `public-job-json-bytes-v2`. It validates the exact strict DTO schema, orders object keys in registered schema order, preserves array order defined by the owning algorithm, renders JSON strings with lowercase `\u` escapes only when JSON requires an escape, renders integers and canonical arbitrary-precision decimals without exponent notation, emits `true`, `false`, and `null` literally, emits zero insignificant whitespace, and encodes the result as UTF-8. Binary floating-point inputs are rejected before serialization. The hash-schema registry pins each DTO schema hash and the serializer identifier.

An active detail has `application.available: true`. A retained closed detail has `application.available: false`, a visible closed presentation, a `noindex` robots directive, and no `JobPosting` object. The Boolean starts the sign-in or authenticated application journey; the public DTO never identifies the route, recipient, intermediary, form, or destination.

## Signed-in private match adapter

The browser calls one authenticated server function after the public document hydrates. Its input is `{ publicId, publicJobVersion }`. The server derives the user from the validated session and returns this strict private response:

```ts
type CandidatePublicJobMatchResponseV1 = {
  schemaVersion: "candidate-public-job-match-v1";
  publicId: string;
  publicJobVersion: number;
  matchingEngineVersion: string;
  computedAt: string | null;
  state: "ready" | "pending" | "stale" | "unavailable";
  match: {
    label:
      | "Strong match"
      | "Likely match"
      | "Needs verification"
      | "Preference mismatch"
      | "Ineligible";
    score: number;
    tone: "positive" | "neutral" | "warning" | "negative";
    criteria: Array<{
      claimKey: string | null;
      claimKind: string | null;
      importance: "required" | "preferred" | null;
      label: string;
      state: "match" | "conflict" | "unknown" | "preference";
    }>;
  } | null;
};
```

`ready` supplies a match. `pending`, `stale`, and `unavailable` supply `match: null`. Criteria include member-visible requirements only, preserving their canonical order. Internal criteria, evidence excerpts, candidate claim answers, profile fields, profile documents, and raw analysis snapshots stay on the server. The response echoes no candidate identity or profile payload.

An absent or invalid session returns `401`. A user requesting another user's state receives `404`. A public version mismatch returns `409` with a current canonical path so the browser can reload the new public version. A private adapter failure leaves the public content usable and displays a localized match retry state.

## Search, filter, sort, and pagination parameters

TanStack Router `validateSearch` owns these typed URL parameters. The [search-parameter guide](https://tanstack.com/router/latest/docs/guide/search-params) describes validated URL state and loader dependencies.

| Parameter        | Exact contract                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `q`              | NFKC, trimmed, internal whitespace collapsed, 1-120 Unicode code points; an empty value becomes absent                       |
| `country`        | One uppercase ISO alpha-2 value on `/jobs`; market routes derive and lock this value from their path                         |
| `workplace`      | `onsite`, `hybrid`, or `remote`                                                                                              |
| `employmentType` | `fullTime`, `partTime`, or `contract`                                                                                        |
| `compensation`   | `stated` selects `kind=amount`; `negotiable` selects `kind=negotiable`                                                       |
| `sort`           | `relevance`, `recent`, `hourlyUsd`, or `title`                                                                               |
| `limit`          | Integer, default `20`, clamped to `1..50`                                                                                    |
| `cursor`         | Opaque base64url payload plus HMAC-SHA-256 signature, maximum 1024 characters, bound to every normalized parameter and scope |

Unknown parameters stay outside loader dependencies and canonical links. Invalid enum values become absent. The first value wins when a singleton parameter repeats. A `q` longer than 120 code points and an invalid or forged cursor return `400`. `relevance` requires `q`; without `q` it normalizes to `recent`. A query with `q` defaults to `relevance`, and every other query defaults to `recent`.

On country and city routes, `query.country` is `null` and `scope` carries the fixed canonical geography. A supplied `country` parameter is removed from canonical links on those routes.

Country matching includes physical worksites in that country and fully remote roles whose applicant-area location includes that country. City membership requires a matching canonical worksite locality; an applicant-area location by itself supplies country membership.

Ordering and cursor tuples are exact:

| Sort        | Order and keyset tuple                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `relevance` | Search rank ascending, effective recency descending, `publicId` ascending                                    |
| `recent`    | Effective recency descending, `publicId` ascending                                                           |
| `hourlyUsd` | Conservative hourly USD value descending with nulls last, effective recency descending, `publicId` ascending |
| `title`     | NFKC case-folded title ascending, `publicId` ascending                                                       |

Effective recency is `datePosted.value` when present and `freshness.materialChangedAt` otherwise. Conservative hourly USD is `hourlyUsd.minimum`, falling back to `hourlyUsd.maximum`. The search relation records its ranking contract version, and tie-breaking stays deterministic.

The signed cursor payload contains the cursor contract version, catalog version, exact `catalogTemporalSnapshotId`, normalized scope and query hash, sort name, and the final row's keyset tuple. The signature key remains a Worker secret. Any catalog or temporal snapshot change makes an old cursor stale; the route returns `409` with a visible link to the same normalized query without `cursor`. This prevents duplicate or skipped rows across a changing catalog.

## Route resolution and lifecycle

The detail route queries `public_job_route_resolutions` with both the public ID and requested slug. The HTTP result is deterministic:

| Stored state or request                             | HTTP result | Behavior                                                               |
| --------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| Active canonical alias                              | `200`       | Active detail DTO, index policy from the public decision               |
| Retained closed canonical alias                     | `200`       | Closed detail DTO, `noindex`, no `JobPosting`, application unavailable |
| Recorded historical alias                           | `308`       | Permanent redirect to the current canonical path                       |
| Recorded merged alias                               | `308`       | Permanent redirect to the terminal winner's canonical path             |
| Recorded merged alias whose terminal winner is gone | `410`       | Gone response                                                          |
| Explicit `gone` alias with prior published history  | `410`       | Gone response                                                          |
| Unknown ID or unknown slug                          | `404`       | Missing response                                                       |
| Private, eligible-only, or suppressed entity        | `404`       | Missing response across HTML, metadata, sitemap, and shared cache      |
| Policy-removed entity without explicit gone state   | `404`       | Missing response                                                       |

The redirect set consists of recorded aliases. Every guessed slug paired with a real public ID returns `404`. Merge resolution follows a flattened terminal winner and rejects cycles at write time. TanStack redirects carry the explicit `308` status and canonical target. RFC 9110 defines the [`404` and `410` statuses](https://www.rfc-editor.org/rfc/rfc9110.html#name-client-error-4xx), and this contract reserves `410` for known permanent removal.

Google permits an expired posting to leave search through a past `validThrough`, a `404`/`410` response, or removal of `JobPosting` markup. The [Google JobPosting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting) governs that SEO lifecycle. JobKit's retained closed page uses visible closed content and removes the markup.

## Cache and validators

Public `200`, `308`, `404`, `409`, and `410` documents use `Cache-Control: public, max-age=0, must-revalidate`. Cloudflare and browsers may store them and must revalidate before reuse. RFC 9111 defines these [cache directives and validators](https://www.rfc-editor.org/rfc/rfc9111.html), and Cloudflare documents its [`Cache-Control` handling](https://developers.cloudflare.com/cache/concepts/cache-control/).

Every public query resolves one `catalogTemporalSnapshotId` from the same current `public_job_catalog_head_pointer` cut. That identity pins catalog version, effective authority heads, active-member and tombstone reductions, search index, market registry, and scheduled-event cutoff. List, detail, sitemap, `JobPosting`, cursor, and validator construction use that one value. A scheduled authority event activates its successor authority and catalog snapshot atomically. Executor wall-clock expiry remains a fail-closed backstop and yields a new logical result that requires a new snapshot identity.

The representation validators are:

- Detail `ETag`: a strong SHA-256 digest over the detail schema and serializer versions, `catalogTemporalSnapshotId`, public content hash, eligibility decision hash, and canonical path.
- List `ETag`: a strong SHA-256 digest over the list schema and serializer versions, `catalogTemporalSnapshotId`, active-membership hash, tombstone/removal hash, search index version, normalized scope and query hash, and cursor payload.
- Detail `Last-Modified`: the latest time any field in the detail representation changed, derived from the public content and eligibility versions.
- List `Last-Modified`: the catalog representation update time.

Sitemap `lastmod` remains the material-content time and excludes verification refreshes. `If-None-Match` takes precedence over `If-Modified-Since`. A matching validator returns `304` with `ETag`, `Last-Modified`, and `Cache-Control`, plus an empty body. Private match responses use `private, no-store`, carry no shared validator, and include `Vary: Cookie`.

## Field-level exclusion boundary

Anonymous DTOs, raw HTML, metadata, JSON-LD, logs attached to the response, and shared cache entries exclude every value in these classes:

- recipient names, email addresses, phone numbers, form destinations, route IDs, route kinds, and intermediary bundle instructions;
- candidate identity, profile values, preferences, qualification answers, private match output, and user IDs;
- credentials, OAuth material, session values, cookies, API keys, board login state, and cursor signing keys;
- documents, document IDs, filenames, attachment packets, passports, diplomas, transcripts, photos, and background checks;
- drafts, revision instructions, messages, attempts, campaign state, outcomes, and follow-up state;
- Gmail message IDs, thread IDs, history IDs, mailbox addresses, push state, labels, and tokens;
- internal listing IDs, source-position IDs, mapping versions, organization IDs, canonical location IDs, Mapbox IDs, raw provider responses, evidence spans, analysis snapshots, decision notes, reason codes, and operator state; and
- raw source descriptions or any unapproved source field.

Public source name and URL values are the single provenance exception, and each one requires its explicit policy field plus attribution mode. Public IDs, versions, canonical paths, and public facts remain available as the DTO defines them.

## Production-shaped acceptance matrix

Every acceptance database starts from the full migration chain and uses realistic multi-source rows, policy heads, immutable content versions, eligibility heads, aliases, locations, routes, and catalog state. Tests call the real repository, TanStack loader, server entry, and rendered route. Mocked DTOs alone provide insufficient evidence.

| Case                           | Production-shaped setup                                                                             | Required evidence                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Active list and detail         | One approved public source, valid route, resolved organization and location, current open listing   | Exact list/detail schemas, active status, application available, same public version                         |
| Required field suppression     | Remove `description`, `title`, `organization_name`, or `locations` from the effective policy fields | Job absent from list, detail `404`, metadata and sitemap absence                                             |
| Optional field suppression     | Remove dates, employment, compensation, or attribution fields one at a time                         | Exact null/empty values; every other allowed fact remains                                                    |
| Policy authoring               | Advance a pending policy head while effective authority stays fixed                                 | Byte-identical list, detail, cursor, ETag, sitemap, and `JobPosting` output                                  |
| Policy activation              | Activate an authorized source-global manifest with a successor catalog temporal snapshot            | Effective authority and every affected public surface cut over atomically                                    |
| Policy expiry                  | Execute the leased scheduled event for an expiring effective policy                                 | New temporal snapshot; stale cursor returns `409`; old ETag fails; list, detail, sitemap, and markup agree   |
| Malformed nested value         | Supply schema-valid JSON with an invalid public shape in an allowed field                           | Fail-closed list absence and detail `404`; raw value absent from HTML                                        |
| Retained closed job            | Current closed decision with `retain_noindex` and prior published history                           | Detail `200`, visible closed state, noindex, no `JobPosting`, application unavailable, list absence          |
| Explicit gone job              | Current `gone` decision with prior published history                                                | `410`, list/sitemap absence                                                                                  |
| Historical slug                | Current active or retained content plus a recorded old alias                                        | `308` to one canonical path                                                                                  |
| Guessed slug                   | Current public ID plus an unrecorded slug                                                           | `404` with no existence-sensitive private detail                                                             |
| Merged job                     | Recorded loser alias and terminal active winner                                                     | One `308` directly to the winner; no redirect chain                                                          |
| Merged-to-gone job             | Recorded loser whose terminal winner is explicitly gone                                             | `410`                                                                                                        |
| Private or suppressed job      | Canonical data exists while the public decision blocks it                                           | `404` across HTML, loader data, metadata, JSON-LD, sitemap, and cache                                        |
| Multi-location job             | Two resolved worksites with coordinates and bounds                                                  | Stable contract ordering and matching visible locations                                                      |
| Remote country job             | Remote workplace plus resolved applicant-area countries                                             | Country filtering includes it; city filtering excludes it without a worksite                                 |
| Query normalization            | Mixed-case country, Unicode query, empty values, unknown keys, and repeated singleton keys          | Exact normalized query object and canonical links                                                            |
| Search relevance               | Versioned search documents with ties                                                                | Deterministic rank, recency, and public-ID ordering                                                          |
| Keyset pagination              | More than 50 tied and untied rows                                                                   | Complete traversal without duplicates; each query uses `limit + 1`; no `OFFSET`                              |
| Stale cursor                   | Advance the catalog after issuing page one                                                          | `409` recovery document and cursor-free restart link                                                         |
| Cache revalidation             | Repeat list and detail requests with matching and stale validators                                  | Correct `304`/`200`, strong ETag, Last-Modified, and cache headers                                           |
| Temporal snapshot coherence    | Race a scheduled expiry with list, detail, sitemap, and `JobPosting` reads                          | Each response uses one complete predecessor or successor snapshot; no mixed authority or catalog state       |
| Anonymous/cookie parity        | Request one public route with no cookie and with a valid candidate cookie                           | Byte-identical public DTO and validators; no `Set-Cookie`; no candidate data                                 |
| Private match ready            | Signed-in owner plus current profile, analysis, and public version                                  | Private DTO, member criteria only, `private, no-store`, `Vary: Cookie`                                       |
| Private match pending or stale | Missing or superseded match inputs                                                                  | Public page remains complete; adapter returns the exact pending or stale state                               |
| Private match authorization    | Anonymous call and cross-user request                                                               | `401` and `404` respectively; zero private payload                                                           |
| Source attribution modes       | Policies covering `none`, `source_name`, and `source_link`                                          | Exact source objects and field suppression for each mode                                                     |
| Raw HTML privacy               | Seed unique sentinel values in every excluded data class                                            | Sentinels absent from text, tags, attributes, comments, scripts, loader serialization, metadata, and JSON-LD |
| JavaScript-disabled SSR        | Request list, detail, closed, redirect, missing, and gone routes with scripts disabled              | Visible content and truthful statuses in the first response                                                  |
| Hydration equality             | Hydrate list and detail success pages                                                               | No public content replacement, mismatch warning, layout shift from private match, or cache-boundary drift    |

### Raw HTML packet

The verification owner saves headers and response bodies for these requests:

```text
GET /jobs
GET /jobs?q=english&country=PL&sort=relevance
GET /jobs/poland
GET /jobs/poland/warsaw
GET /job/<publicId>/<canonicalSlug>
GET /job/<publicId>/<historicalSlug>
GET /job/<closedPublicId>/<canonicalSlug>
GET /job/<gonePublicId>/<canonicalSlug>
GET /job/<unknownId>/<unknownSlug>
```

The packet proves visible list and detail facts in raw HTML, one canonical URL, the exact status and redirect target, robots state, structured-data eligibility, and cache headers. A sentinel scan covers case-folded and encoded forms of email, phone, recipient, candidate, credential, document, draft, attempt, and Gmail values. A second request with a valid session cookie proves public byte parity. The private match request is captured separately and proves the private cache boundary.

## Implementation gaps and follow-up ownership

This research slice changes no application code or migration. The implementation owner must close these observed gaps:

1. The TanStack Start handler currently receives only `Request`; it needs the typed Worker environment and D1 binding in request context.
1. Public list, country, city, and detail routes currently render placeholders or `404`; they need the repository and loaders defined here.
1. Migration 0048 needs a successor that applies required-field gating and optional-field suppression, exposes full safe location snapshots, and adds detail validator inputs.
1. D1 needs successor semantics for the existing `public_browse_job_locations`, `public_job_search_index`, `public_job_catalog_head_pointer`, `public_job_catalog_head_history`, and `public_job_catalog_head` read view, including temporal snapshot identity, active and tombstone reductions, and suitable indexes.
1. Source attribution needs a versioned public display-label mapping and URL sanitizer.
1. Public compensation needs a version-pinned FX snapshot and a persisted `hourlyUsd` representation.
1. The private adapter needs a deterministic public-position-to-analysis mapping plus member-visible criterion filtering.
1. Route resolution needs an explicit terminal result for merged-to-gone jobs and a tested cycle/chain invariant.

The implementation may choose the D1 search-index engine and physical facet storage. Those choices must preserve the exact query, ranking, cursor, and DTO semantics above. All product decisions required by `PUBLIC-DTO-001` are fixed by this contract.

## Primary references

- [TanStack Start server entry point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point)
- [TanStack Start selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)
- [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [TanStack Router search parameters](https://tanstack.com/router/latest/docs/guide/search-params)
- [TanStack Router redirect type](https://tanstack.com/router/latest/docs/api/router/RedirectType)
- [Cloudflare cache control](https://developers.cloudflare.com/cache/concepts/cache-control/)
- [Cloudflare D1 query guidance](https://developers.cloudflare.com/d1/best-practices/query-d1/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [RFC 9110 HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111 HTTP caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [Google JobPosting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
