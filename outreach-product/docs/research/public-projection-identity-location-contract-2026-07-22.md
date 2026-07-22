# Public projection identity and location contract

**Status:** Canonical supporting contract for D2 and D3 identity resolution\
**Contract version:** `public-projection-identity-location-v2`\
**Contract date:** 2026-07-22

## Purpose and module authority

This contract owns duplicate comparison, deterministic durable identity, allocation and merge winners, organization resolution, and Mapbox-backed location resolution. It produces a sealed D3 graph and canonical-resolution snapshots.

The public projection module family owns downstream mechanics:

- [Candidate core](public-projection-candidate-core-contract-2026-07-22.md) consumes the D3 graph, applies current effective field policy, and produces private candidate facts.
- [Application authority](public-application-authority-contract-2026-07-22.md) owns routes, destinations, verification, and employer authority.
- [Catalog and temporal authority](public-catalog-temporal-contract-2026-07-22.md) owns catalog membership and authority cutovers.
- [Promotion activation](public-promotion-activation-contract-2026-07-22.md) owns shadow-to-live execution and the 46-slot activation.

This contract defines identity truth and creates zero live projection or catalog writes.

## Fixed decisions

1. Retrieval finds evidence candidates; terminal evidence or an immutable operator decision establishes identity.
1. Duplicate targets are tagged existing-public versions or sealed same-run positions.
1. Durable public IDs derive from an immutable founding source position.
1. An existing public identity wins over a duplicate new identity. Merge history preserves previously served canonical routes.
1. Organization and location ambiguity keeps the component private. Provider or schema failures remain operational errors.
1. Persistent locations use Mapbox Geocoding v6 with `permanent=true`.
1. Provider order, database order, source order, and model confidence supply no factual tie-break.
1. D3 resolution uses the complete policy-independent evidence set and records every decisive evidence source.

## Sealed stage order

1. Derive source-position identity plus `material_clone_v1` and `source_reference_v1` from sealed listing material.
1. Seal D2 stable-source comparisons with `canonical_identity_state=pending`.
1. Resolve organization and location evidence and derive `canonical_identity_v1`.
1. Finalize D3 comparisons against existing-public and same-run candidates.
1. Resolve every identity-affecting edge to `same`, `different`, or `none`.
1. Block a component containing an `ambiguous` edge until a successor run has stronger evidence or a terminal operator decision.
1. Produce immutable components and allocation artifacts for candidate core.

Algorithm identifiers are `public-duplicate-retrieval-v1`, `public-duplicate-finalization-v1`, `public-job-allocation-v1`, `organization-resolver-v1`, and `mapbox-location-resolver-v1-us`.

## Duplicate references and decisions

```text
public_job_version = public_job_id + public_job_version + redirect_root_id
shadow_position    = run_id + position_item_id + source_position_id + input_hash
```

A same-run pair is stored once under the bytewise-lower fully qualified member. The comparison identifier hashes the two ordered member keys under `jobkit-projection-duplicate-pair/v1`.

Retrieval order is:

1. Current mapping for the same source-position ID.
1. Exact source reference, source key, and position key.
1. Exact material clone and position key.
1. Exact canonical identity.
1. Listing-level collisions with a different position key.

Existing-public targets precede shadow targets within a tier. Existing targets sort by redirect-root ID and pinned version. Shadow targets sort by position-item ID.

| Relation  | Reason                           | Rule                                                                                    |
| --------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| same      | `same_source_position`           | Current mapping already names the root                                                  |
| same      | `same_source_reference_position` | Source key, nonempty reference, and position key match without stable-employer conflict |
| same      | `same_employer_requisition`      | Employer requisition, organization, and position discriminator match                    |
| same      | `operator_confirmed_same`        | Immutable operator decision confirms the pair                                           |
| different | `same_listing_distinct_position` | Valid position keys differ inside one listing                                           |
| different | `conflicting_stable_identifier`  | Stable employer identifiers conflict                                                    |
| different | `conflicting_canonical_facts`    | Organization or position-defining facts conflict                                        |
| different | `operator_confirmed_different`   | Immutable operator decision separates the pair                                          |
| ambiguous | `canonical_identity_only`        | Canonical facts match while vacancy evidence remains absent                             |
| ambiguous | `duplicate_evidence_conflict`    | Strong evidence conflicts                                                               |
| ambiguous | `operator_deferred`              | Operator preserves the edge for later evidence                                          |
| none      | `no_duplicate_candidate`         | Retrieval yields zero targets                                                           |

Codex advice may recommend same, different, or unclear and remains review evidence. Terminal identity comes from deterministic rules or operator action.

## Durable allocation and merge winner

An all-new connected same component selects the bytewise-lowest `source_position_id` as founding anchor:

```text
public_job_id =
  "pjob_v1_" +
  lowerHex(SHA256(
    "jobkit-public-job/v1" || NUL || foundingSourcePositionIdUtf8
  ))
```

The allocation artifact stores algorithm version, sorted component members, founding anchor, candidate roots, winner, terminal relations, reasons, and exact payload hash. A matching ID is idempotent only when founding anchor and allocation hash match.

Existing candidate roots first follow merge redirects to terminal roots. Winner selection uses this tuple:

1. A root with served public history before one without it.
1. Earliest first-published decision time.
1. Earliest immutable `public_jobs.created_at`.
1. Bytewise-lowest public job ID.

Losers derive merged state and point to the terminal winner. Mapping intents move their source positions to the winner. Redirect graphs flatten and remain acyclic. A later split keeps the founding-anchor component on the original ID and derives each other component from its own lowest source-position anchor.

## Organization resolution

Organization candidates use the highest available positive tier:

| Tier | Positive evidence                                                                                        | Use                                               |
| ---- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1    | Current operator-accepted opportunity link or sealed source-native employer mapping                      | Resolve when valid and free of hard contradiction |
| 2    | Verified employer-controlled registrable domain or verified organization-owned ATS tenant                | Resolve one matching organization                 |
| 3    | Exact normalized company name, ISO country, and canonical locality with supporting organization evidence | Resolve one active match                          |
| 4    | Name plus country, contact domain, unverified ATS, recruiter, or intermediary label                      | Candidate retrieval only                          |

Public mailbox, job-board, recruiter, intermediary, generic-form, and URL shortener domains establish zero hiring-organization identity by themselves. Route ownership and hiring-organization identity remain separate facts.

Names use Unicode 16.0.0 NFKC case folding. Domains use a version-pinned Public Suffix List. Countries use ISO alpha-2; localities use canonical location IDs. Evidence sorts by tier, source key, evidence kind, observed time, evidence ID, and organization ID.

One active candidate at the strongest tier resolves when hard facts agree. Two strongest-tier candidates or a hard tier-1/tier-2 contradiction produce ambiguous. Zero candidates produce unresolved. The immutable snapshot stores state, selected organization and display name, resolver version, ordered candidates, positive and conflicting evidence, input hashes, decisive evidence bindings, and reason.

## Mapbox-backed location resolution

Persistent forward geocoding uses Mapbox v6 with these parameters:

| Parameter      | Value                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| `q`            | Literal source-backed label                                             |
| `permanent`    | `true`                                                                  |
| `autocomplete` | `false`                                                                 |
| `language`     | `en`                                                                    |
| `limit`        | `10`                                                                    |
| `worldview`    | `us`                                                                    |
| `country`      | Evidenced ISO alpha-2 country when available                            |
| `types`        | Semantic-kind mapping below                                             |
| `bbox`         | Previously resolved parent bounds from the same evidence when available |
| `proximity`    | Omitted                                                                 |

Semantic type mapping is country to `country`, region to `region`, city to `place,locality,district`, postal code to `postcode`, and address to `address`. Unknown uses the complete supported type set and retains ambiguity rules.

Each feature preserves provider ID, feature type, names, translations, context, country and region codes, coordinates, accuracy, bounds, provider order, and address match code. Provider rank alone selects nothing.

```text
canonicalLocationId =
  "loc_v1_" +
  lowerHex(SHA256(
    "jobkit-canonical-location/v1" || NUL ||
    "mapbox-geocoding-v6" || NUL || mapboxIdUtf8
  ))
```

A viable feature matches semantic type, country, every canonical parent, and the literal name or address components. Explicit address components must be matched, plausible, or source-supported inferred values. One viable feature resolves, several produce ambiguous, and zero produce unresolved. Conflicting countries or parents produce ambiguous. Invalid geographic assertions produce invalid state.

Authentication, authorization, rate-limit, timeout, transport, schema, and permanent-storage failures produce operational reason codes and retry or block the item. The immutable snapshot stores literal evidence, query parameters excluding token, request and response hashes, resolver version, query time, ordered raw candidates, normalized viable candidates by provider ID, selected provider identity, state, reason, and decisive evidence bindings.

## Workplace and ordering rules

| Source fact                            | Canonical form                                       | Public consequence                                                                     |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Onsite or hybrid place                 | Resolved worksite                                    | Eligible after other gates                                                             |
| Finite worksites                       | Ordered resolved worksite set                        | Visible and `JobPosting` locations agree                                               |
| Countrywide onsite placement           | Country worksite with countrywide scope and centroid | Browse eligible when truthful; excluded from `JobPosting` until finite worksites exist |
| Fully remote in named geography        | Applicant-area locations with remote workplace type  | `TELECOMMUTE` plus matching applicant requirements                                     |
| Worldwide remote without named country | Worldwide unresolved applicant geography             | Private under fail-closed rules                                                        |
| Hybrid or optional home work           | Physical worksite with supplemental applicant area   | `TELECOMMUTE` omitted                                                                  |
| Ambiguous or conflicting location      | Ambiguous snapshot                                   | Private                                                                                |

Location ordinals sort by role, scope specificity, country, region, locality, display name, and canonical location ID. Identity signals use the sorted canonical location ID set.

## Policy-independent identity boundary

D3 stores the complete identity result and decisive evidence before publication policy. Candidate core applies current effective field policy to those decisive sources. A withheld decisive source makes the root private. The canonical identity stays fixed, preserving duplicate and allocation truth.

Public-safe outputs are durable ID, canonical organization display name, and resolved location snapshots. Comparison members, source IDs, provider IDs, raw responses, evidence spans, contact data, and operator decisions remain private.

## Acceptance requirements

- Replay and input-order reversal produce byte-identical comparisons, components, allocations, organizations, locations, and hashes.
- Same-listing siblings with distinct position keys resolve different.
- Canonical-only recurring-role evidence remains ambiguous.
- Founding-anchor IDs remain stable when later sources join.
- Existing roots select the exact served-history winner and preserve an acyclic redirect graph.
- Organization fixtures cover every evidence tier, equal-tier ambiguity, hard contradiction, intermediary-only evidence, invalid candidates, and correction.
- Mapbox fixtures cover country, region, city, address, multiple worksites, countrywide, remote, worldwide, ambiguous names, conflicting geography, zero results, provider failures, and address match-code conflict.
- Source-order changes preserve location ordinals and identity hashes.
- Policy-withheld decisive evidence preserves D3 identity and makes candidate publication private through the core contract.
- The identity workflow writes sealed D2/D3 and allocation artifacts while all live entity, route, catalog, search, and promotion relations retain identical before-and-after digests.

## References

- [Mapbox Geocoding API v6](https://docs.mapbox.com/api/search/geocoding/)
- [Google JobPosting requirements](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- [`PRODUCT.md`](../../PRODUCT.md)
- [`public-discovery.md`](../user-flows/public-discovery.md)
- [`0048_public_job_entities.sql`](../../migrations/0048_public_job_entities.sql)
- [`0049_public_projection_runs.sql`](../../migrations/0049_public_projection_runs.sql)
- [`0051_public_projection_duplicate_comparisons.sql`](../../migrations/0051_public_projection_duplicate_comparisons.sql)
