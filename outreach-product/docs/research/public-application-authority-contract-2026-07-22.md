# Public application authority contract

**Status:** Design contract pending independent acceptance\
**Work item:** `PUBLIC-CANDIDATE-001/B`\
**Contract date:** 2026-07-22

## Authority and boundary

This contract owns public route state, application contacts and destinations, destination policy, verification, employer authority, application-authority snapshots, and legacy application-attempt migration.

The [candidate core](public-projection-candidate-core-contract-2026-07-22.md) consumes one opaque snapshot reference with snapshot ID, hash, state, effective time, and expiry. Candidate construction reads none of the private route, contact, destination, verification, or employer fields defined here.

The [catalog and temporal contract](public-catalog-temporal-contract-2026-07-22.md) owns scheduled expiry and coherent public snapshot cutover. The [promotion contract](public-promotion-activation-contract-2026-07-22.md) owns live activation. The [DTO contract](public-job-dto-and-private-match-contract-2026-07-22.md) owns anonymous rendering and preserves destination privacy.

## Public route state

```text
public_job_route_versions
  PK (public_job_id, version)
  UNIQUE (public_job_id, idempotency_key)
  columns:
    public_job_id, version, predecessor_version,
    canonical_slug, canonical_path,
    alias_set_hash, redirect_state_hash,
    disposition=serve|private|redirect|retain_noindex|gone,
    redirect_public_job_id,
    market_registry_version,
    route_hash, idempotency_key, created_at

public_job_aliases
  PK (public_job_id, slug)
  columns:
    public_job_id, slug, route_version,
    alias_kind=canonical|historical,
    target_path, redirect_status,
    alias_hash, created_at

public_job_route_heads
  PK public_job_id
  columns: public_job_id, current_version, updated_at
```

`public-job-route-state-v1` derives a title slug with Unicode 16.0.0 NFKD, combining-mark removal, lowercase ASCII alphanumeric token extraction, hyphen joining, and a 200-character maximum. An empty token sequence yields `job`.

The canonical leaf path is `/job/:publicId/:slug`. Equal slugs across distinct public IDs are valid. Registered historical aliases redirect with `308` to the current path. A guessed alias returns `404`. A merged root redirects to its flattened winner. A deleted root and a closed root lacking retained public value return `410`.

The public route hash covers canonical slug, path, alias reduction, disposition, redirect target, and market-registry version. A change creates one immutable route successor.

## Stable source route identity

New collectors derive route identity from the declaration slot:

```text
sourceRouteKey =
  "declared:v1:" + sourceKey + ":" + normalizedJsonPointer
```

The JSON pointer uses RFC 6901 escaping and a collector-version-owned ordinal. A destination or evidence update retains the source route key and creates a route successor.

Legacy identity uses the exact UTF-8 text stored in `application_routes.id`:

```text
sourceRouteKey =
  "legacy:v2:application_routes:" +
  lowerHex(SHA256(
    "jobkit-legacy-application-route-id/v2\0" ||
    LP(exactLegacyRouteIdUtf8)
  ))
```

The backfill preserves bytes exactly. Decimal parsing, numeric coercion, trimming, normalization, and case folding stay outside this algorithm.

```text
routeId =
  "proute_v2_" +
  lowerHex(SHA256(
    "jobkit-application-route/v2\0" ||
    LP(listingIdUtf8) ||
    LP(sourceRouteKeyUtf8) ||
    LP(applicabilityUtf8) ||
    LP(sourcePositionIdOrEmptyUtf8)
  ))
```

## Route, destination, contact, and verification versions

```text
application_route_versions
  PK (route_id, version)
  UNIQUE (route_id, idempotency_key)
  columns:
    route_id, version, predecessor_version,
    job_id, source_route_key,
    kind=email|board_form|external_url|login_gated_form|phone|manual,
    purpose=application,
    applicability=exact_position|listing_shared,
    source_position_id, listing_id,
    listing_material_version, listing_material_hash,
    normalized_destination, destination_hash,
    controller=employer|authorized_recruiter|board|intermediary,
    execution_flow=FLOW-010|FLOW-011|FLOW-012|UNSPECIFIED,
    route_surface=public_apply|campaign_only|authenticated_manual,
    destination_policy_version,
    contact_evidence_version,
    declared_primary, declared_ordinal,
    evidence_json, evidence_hash,
    route_content_hash, route_hash,
    effective_at, idempotency_key, created_at

application_route_heads
  PK route_id
  columns: route_id, current_version, updated_at

application_route_destination_policy_versions
  PK (source_key, version)
  columns:
    predecessor_version, allowed_schemes_json,
    allowed_hosts_json, allowed_redirect_hosts_json,
    max_redirects, policy_hash, effective_at,
    expires_at, revoked_at, created_at

application_route_destination_policy_heads
  PK source_key

application_route_contact_evidence_versions
  PK (contact_channel_id, version)
  columns:
    predecessor_version, source_position_id,
    listing_material_version, channel_kind,
    normalized_value_hash, application_purpose,
    state=active|inactive|revoked|unknown,
    evidence_json, evidence_hash,
    effective_at, expires_at, revoked_at,
    contact_evidence_hash, created_at

application_route_contact_evidence_heads
  PK contact_channel_id

application_route_verification_versions
  PK (route_id, version)
  UNIQUE (route_id, idempotency_key)
  columns:
    route_id, version, predecessor_version,
    route_version, destination_policy_version,
    contact_evidence_version,
    verifier_kind=deterministic|operator,
    verifier_id, checked_at, effective_at, expires_at,
    state=usable|unusable|unknown|revoked,
    redirect_chain_json, terminal_destination_hash,
    response_state, evidence_json, evidence_hash,
    verification_hash, idempotency_key, created_at

application_route_verification_heads
  PK route_id
  columns: route_id, current_version, updated_at
```

Email verification requires a syntactically valid normalized address, active matching contact evidence, and an application-purpose assertion. URL and form verification requires HTTPS, empty credentials and fragment, allowed initial and terminal hosts, and an allowed redirect chain. Phone verification requires E.164 and active application-purpose evidence. Manual routes require sealed authenticated instructions.

One valid declared primary wins. Conflicting primaries produce unresolved state. Remaining routes sort by exact position before listing shared; employer before authorized recruiter, board, then intermediary; flow 010 before 011, 012, then unspecified; declared ordinal; and route ID bytes. A prior selected route stays selected within the winning rank class.

Public application readiness requires current unexpired route, verification, destination-policy, contact-evidence, source-open, and employer-authority heads; usable verification; open root aggregate; `route_surface=public_apply`; and flow 010 or 011. Flow 012 remains campaign-only. Phone and manual routes remain authenticated-manual.

## Employer authority

```text
public_job_employer_authority_versions
  PK (public_job_id, version)
  UNIQUE (public_job_id, idempotency_key)
  columns:
    public_job_id, version, predecessor_version,
    public_job_version, organization_id,
    state=verified|unverified|revoked|conflict,
    proof_kind=
      employer_owned_domain|verified_source_employer_id|operator_approval,
    origin_assertion_version,
    organization_resolution_version,
    domain_registry_version,
    source_employer_id_registry_version,
    operator_approval_version,
    writer_kind=deterministic|operator,
    writer_version, operator_user_id,
    evidence_json, evidence_hash,
    checked_at, effective_at, expires_at, revoked_at,
    authority_hash, idempotency_key, created_at

public_job_employer_authority_heads
  PK public_job_id

public_job_employer_operator_approval_versions
  PK (public_job_id, version)
  columns:
    expected_public_job_version,
    organization_id, evidence_hash,
    operator_user_id, operator_role,
    effective_at, expires_at, revoked_at,
    approval_hash, created_at
```

Deterministic verification accepts an employer-controlled position on a verified organization-owned domain or ATS tenant, or an immutable source-employer-ID mapping that resolves to the same organization. Operator approval pins exact evidence, organization, public version, effective time, and expiry. Board or intermediary identity by itself supplies zero hiring-employer proof.

## Opaque application-authority snapshot

This module reduces current route and employer authority into one immutable snapshot:

```text
public_application_authority_snapshots
  PK application_authority_snapshot_id
  UNIQUE application_authority_snapshot_hash
  columns:
    public_job_id,
    public_job_version,
    public_route_state_version,
    public_route_state_hash,
    selected_route_id,
    selected_route_version,
    selected_route_hash,
    route_verification_version,
    route_verification_hash,
    destination_policy_version,
    destination_policy_hash,
    contact_evidence_version,
    contact_evidence_hash,
    employer_authority_version,
    employer_authority_hash,
    source_open_version,
    source_open_hash,
    state=usable|unavailable|stale,
    reason_codes_json,
    effective_at,
    expires_at,
    application_authority_snapshot_hash,
    created_at
```

The snapshot hash is a registered record hash over every listed semantic column except ID and creation time. The identifier is `pauth_v1_` plus the lowercase hexadecimal snapshot hash. `expires_at` is the earliest non-null expiry among its selected authorities.

The snapshot is usable when every selected head matches, each authority is effective and unrevoked, route verification is usable, and public application readiness passes. A successor authority creates a successor snapshot. Core sees only the six-field reference defined in its contract.

## Legacy attempt migration

SQLite rebuilds `application_attempts` to add immutable authority pins and `stale_authority`:

1. Create `application_attempts_0058_new` with existing columns and constraints, plus route, verification, destination-policy, contact-evidence, source-open, eligibility, public-route-state, and application-authority snapshot versions and hashes; `authority_checked_at`; `legacy_unverified`; and `stale_authority`.
1. Snapshot each mutable legacy route as version 1 with the exact UTF-8 legacy key and create its head.
1. Copy every attempt once, preserving IDs, user, job, draft, payload, recipient, subject, Gmail IDs, timestamps, errors, and terminal outcome.
1. Populate exact authority pins where evidence supports them. Historical terminal attempts lacking immutable verification receive `legacy_unverified=1` and nullable historical verification pins.
1. Assert source and destination row counts, primary and unique keys, payload hashes, terminal counts, sent identifiers, and foreign keys.
1. Rename the old table to `application_attempts_0058_legacy`, rename the new table, recreate indexes, triggers, foreign keys, and views, run `PRAGMA foreign_key_check`, and remove the legacy table inside the migration transaction after every assertion passes.
1. Extend `public_job_aliases` in place with route-version and redirect columns, backfill existing aliases, preserve the existing public-version foreign key, and assert row counts.

Historical sent outcomes remain factual history. A pending or approved unsent legacy attempt selects a current authority snapshot and returns to review before claim.

Claim and the final pre-provider-send transaction compare the complete pinned snapshot, payload hash, all current authority heads, expiry and revocation state, source-open state, root eligibility, and application availability. Drift before provider invocation moves the attempt to `stale_authority` and emits a review event. Drift after an ambiguous provider response produces `uncertain`.

## JobPosting authority contribution

This module contributes current verified employer authority and current public application availability to `public-jobposting-eligibility-v2`. The DTO and catalog contracts combine those inputs with visible content, location, dates, and temporal snapshot identity. `directApply` remains omitted.

## Acceptance requirements

Independent acceptance covers:

- exact UTF-8 legacy IDs, including numeric-looking strings, leading zeroes, Unicode, and mixed case;
- canonical `/job/:publicId/:slug` behavior for serve, historical, merged, retained, gone, guessed, and missing routes;
- deterministic route selection and conflicting primary declarations;
- URL redirect and host-policy enforcement;
- email, phone, manual, expired, and revoked contact evidence;
- employer-domain, source-employer-ID, operator, conflict, expiry, and revocation cases;
- snapshot determinism, earliest expiry, head drift, and opaque core transport;
- full application-attempt row-count, hash, status, and foreign-key migration assertions; and
- claim and final-send races that yield `stale_authority` or `uncertain` at the specified provider boundary.
