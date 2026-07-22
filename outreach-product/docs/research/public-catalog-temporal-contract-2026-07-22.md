# Public catalog and temporal authority contract

**Status:** Design contract pending independent acceptance\
**Work item:** `PUBLIC-CANDIDATE-001/C`\
**Contract date:** 2026-07-22

## Authority and boundary

This contract owns active and tombstone catalog fragments, effective and pending authority targets, source-global activation, emergency revocation, scheduled expiry, immutable causal cuts, and catalog temporal snapshots.

The [candidate core](public-projection-candidate-core-contract-2026-07-22.md) produces private semantic facts using current effective policies. The [application-authority contract](public-application-authority-contract-2026-07-22.md) produces route and application snapshot inputs. The [promotion contract](public-promotion-activation-contract-2026-07-22.md) compiles and activates candidate-owned catalog changes. This module owns every catalog or authority transaction that spans roots independently of one candidate.

## Canonical live names

Successor migrations preserve these established names:

- `public_job_catalog_head_pointer` as the one-row write authority;
- `public_job_catalog_head_history` as immutable history;
- `public_job_catalog_head` as the read view over the pointer and immutable catalog version;
- `job_source_position_mapping_versions` and `job_source_position_mapping_heads`; and
- `public_job_decision_sources`.

Parallel catalog-head, mapping, or decision-source vocabularies remain outside the design.

## Effective and selected authority targets

Manifests use two strict, byte-sorted sets:

```ts
type EffectiveAuthorityTargetV2 = {
  authorityKind: "source_policy" | "source_label" | "market_registry";
  authorityKey: string;
  effectiveVersion: string;
  effectiveHash: string;
};

type PendingAuthorityTargetV2 = {
  authorityKind: "source_policy" | "source_label" | "market_registry";
  authorityKey: string;
  expectedEffectiveVersion: string;
  expectedEffectiveHash: string;
  selectedPendingVersion: string;
  selectedPendingHash: string;
};
```

`expectedEffectiveAuthorityTargets` freezes the effective heads used by the plan. `selectedPendingAuthorityTargets` identifies exact pending versions that an activation exposes. Ordinary authoring advances pending heads and has zero public effect. An omitted pending target stays pending.

Main candidate promotion carries an empty source-policy and source-label selection. Source-global activation owns those authority kinds. A main manifest may select one exact market-registry target when it owns the complete catalog closure for that target.

## Pending and effective heads

```text
source_publication_policy_pending_heads
source_publication_policy_effective_heads
public_source_display_label_pending_heads
public_source_display_label_effective_heads
public_market_slug_registry_pending_head
public_market_slug_registry_effective_head
```

Each keyed head stores current version, current hash, activation ID, and update time. A pending head uses a null activation ID. An effective head references the activation or emergency action that exposed it. Public repositories read effective heads exclusively.

## Market slug registry

```text
public_market_slug_registry_versions
  PK version
  columns:
    predecessor_version, entry_count,
    registry_hash, created_at

public_market_slug_registry_entries
  PK (registry_version, entry_kind, entry_key)
  UNIQUE (registry_version, route_namespace, slug)
  columns:
    entry_kind=country|city,
    entry_key, country_code, canonical_location_id,
    route_namespace, slug, display_name,
    alias_count, alias_set_hash, entry_hash

public_market_slug_registry_aliases
  PK (registry_version, entry_kind, entry_key, alias_slug)
  UNIQUE (registry_version, route_namespace, alias_slug)
  columns:
    route_namespace, alias_slug,
    target_slug, alias_hash
```

Country keys use ISO alpha-2 and namespace `country`. City keys use canonical location ID and namespace `city:<country-code>`. Country slugs are globally unique; city slugs are unique within their country.

A new entry tries its normalized base slug. A collision appends the first eight lowercase hexadecimal characters of `SHA256(entry_kind || NUL || entry_key)`, then extends by two characters until unique. Exhaustion blocks with `market_slug_collision_exhausted`. Alias collision with another current canonical or alias blocks with `market_alias_collision`. Historical aliases remain attached to their key. Authoring advances the pending head; catalog activation advances one exact effective registry target.

## Active and tombstone fragments

Candidate-owned catalog facts compile into one fragment per affected public root:

```ts
type CatalogFragmentV2 =
  | {
      state: "active";
      publicJobId: string;
      publicJobVersion: string;
      eligibilityDecisionVersion: string;
      routeStateVersion: string;
      applicationAuthoritySnapshotId: string;
      listItemHash: string;
      detailHash: string;
      searchDocumentHash: string;
      marketFacetDigest: string;
      jobPostingEligibilityHash: string;
      membershipLeafHash: string;
    }
  | {
      state: "tombstone";
      publicJobId: string;
      predecessorCatalogVersion: string;
      predecessorMembershipLeafHash: string;
      terminalDisposition:
        | "private"
        | "closed"
        | "suppressed"
        | "deleted"
        | "merged"
        | "policy_withheld";
      redirectPublicJobId: string | null;
      tombstoneLeafHash: string;
    };
```

`membershipLeafHash` and `tombstoneLeafHash` are registered record hashes over the exact union member. Active and tombstone leaves sort by public job ID UTF-8 bytes. Their reductions are:

```text
activeMembershipHash =
  registeredReductionHash(
    "activeMembershipHash",
    orderedMembershipLeafHashes
  )

tombstoneReductionHash =
  registeredReductionHash(
    "tombstoneReductionHash",
    orderedTombstoneLeafHashes
  )
```

One root has exactly one active or tombstone fragment in a successor catalog. A tombstone preserves enough predecessor and terminal information to prove removal, redirects, cache invalidation, sitemap exclusion, and search deletion.

## Catalog versions and current read model

```text
public_job_catalog_versions
  PK catalog_version
  UNIQUE catalog_hash
  columns:
    predecessor_catalog_version,
    active_root_count, active_membership_hash,
    tombstone_count, tombstone_reduction_hash,
    search_content_hash,
    effective_policy_heads_digest,
    effective_label_heads_digest,
    effective_market_registry_hash,
    catalog_hash, created_at

public_job_catalog_active_members
  PK (catalog_version, public_job_id)
  columns:
    public_job_version, eligibility_decision_version,
    route_state_version, application_authority_snapshot_id,
    membership_leaf_hash

public_job_catalog_tombstones
  PK (catalog_version, public_job_id)
  columns:
    predecessor_catalog_version,
    predecessor_membership_leaf_hash,
    terminal_disposition, redirect_public_job_id,
    tombstone_leaf_hash
```

The current browse, search, sitemap, route, and `JobPosting` views join through the one current pointer and one temporal snapshot. Catalog children are live relations created by promotion or authority activation; candidate core contains neither these rows nor their foreign keys.

## Catalog temporal snapshot

One immutable identity pins the complete public read cut:

```text
public_job_catalog_temporal_snapshots
  PK catalog_temporal_snapshot_id
  UNIQUE catalog_temporal_snapshot_hash
  columns:
    catalog_version,
    effective_policy_heads_digest,
    effective_label_heads_digest,
    effective_market_registry_hash,
    employer_authority_heads_digest,
    application_authority_heads_digest,
    route_authority_heads_digest,
    lifecycle_action_heads_digest,
    scheduled_event_cutoff_time,
    scheduled_event_cutoff_id,
    active_membership_hash,
    tombstone_reduction_hash,
    search_content_hash,
    catalog_temporal_snapshot_hash,
    created_at
```

`catalogTemporalSnapshotHash` is a registered record hash over those fields in listed order except ID and creation time. The ID is `pctsnap_v2_` plus the lowercase hash. The ID appears in catalog seals, DTOs, cursors, ETags, sitemap reads, `JobPosting` reads, and activation manifests.

`public_job_catalog_head_pointer` stores `current_version` and `current_temporal_snapshot_id`. `public_job_catalog_head_history` records both values for every cutover. A transaction updates the pair together. The read view exposes that pair from the pointer.

## Reverse dependency closure

Authority activation starts from one authority subject and follows current and historical source-position mappings, public decision sources, canonical and field-source bindings, D3 resolution bindings, route and alias ownership, allocation winner and loser edges, active members, tombstones, search documents, market facets, `JobPosting` authority, lifecycle heads, employer heads, application-authority snapshots, and redirect roots that affect HTTP behavior.

Closure ends at byte-sorted terminal public roots plus retained alias roots. It stores root count and `affectedRootReductionHash`. The activation plan covers the complete reverse closure.

## Source-global activation

```text
public_projection_source_global_activation_manifests
  PK manifest_id
  UNIQUE replay_key
  columns:
    expected_effective_authority_targets_json,
    selected_pending_authority_targets_json,
    affected_root_count, affected_root_reduction_hash,
    predecessor_catalog_version,
    predecessor_catalog_temporal_snapshot_id,
    successor_catalog_version,
    successor_catalog_temporal_snapshot_id,
    active_membership_hash, tombstone_reduction_hash,
    promotion_limits_evidence_version,
    promotion_limits_evidence_hash,
    component_count, operation_count, statement_count,
    plan_hash, manifest_hash, replay_key,
    state=prepared|authorized|claimed|completed|quarantined_oversize|superseded|failed,
    created_at, completed_at
```

Source-global component count is independent from main candidate component bounds. Admission limits come from the pinned remote-D1 limits artifact owned by the promotion contract. Plans with more than 25 affected roots are valid when the limits artifact admits their exact components, statements, bytes, and execution evidence. An oversize plan becomes `quarantined_oversize`, preserving effective heads and the catalog pointer. A smaller successor plan, a newly benchmarked limits artifact, or emergency revocation may proceed.

The source-global transaction reasserts every effective predecessor, advances only selected policy or label pending targets, installs the successor catalog and temporal snapshot, records history, emits causal and outbox events, and terminalizes the manifest atomically.

## Emergency revocation

```text
public_projection_emergency_revocation_manifests
  PK manifest_id
  UNIQUE replay_key
  columns:
    source_key,
    blocked_successor_policy_version,
    blocked_successor_policy_hash,
    expected_effective_policy_version,
    expected_effective_policy_hash,
    affected_root_count, affected_root_reduction_hash,
    predecessor_catalog_temporal_snapshot_id,
    successor_catalog_version,
    successor_catalog_temporal_snapshot_id,
    successor_kind=filtered|quarantine,
    active_membership_hash, tombstone_reduction_hash,
    promotion_limits_evidence_version,
    promotion_limits_evidence_hash,
    operation_count, statement_count,
    plan_hash, manifest_hash, replay_key,
    state=prepared|authorized|claimed|completed|superseded|failed,
    created_at, completed_at
```

The emergency transaction asserts the current effective policy, predecessor snapshot, complete affected-root reduction, limits evidence, lease, manifest, and scheduled-event cutoff. It advances to the blocked successor and a filtered or quarantine catalog in one commit, records history, emits causal and outbox events, and terminalizes the manifest. Replay returns the stored result for the same key. A changed predecessor, root reduction, cutoff, limits artifact, plan, or catalog creates a new replay key.

## Scheduled expiry

Every expiring source-open, source policy, source label, route verification, destination policy, contact evidence, employer authority, operator approval, lifecycle action, or application-authority snapshot creates one event:

```text
public_projection_scheduled_events
  PK scheduled_event_id
  UNIQUE (authority_kind, authority_key, authority_version, scheduled_at)
  columns:
    authority_kind, authority_key, authority_version,
    scheduled_at, payload_hash,
    state=pending|claimed|completed|superseded|failed,
    lease_owner, lease_token, lease_epoch,
    lease_expires_at, attempt_count,
    causal_event_id, successor_temporal_snapshot_id,
    created_at, completed_at
```

Claim and completion compare token, epoch, and `lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`. The executor appends the authority successor, rebuilds the affected catalog, and advances the authority head and temporal snapshot atomically. Public readers compare wall clock with pinned expiry as a fail-closed backstop. A wall-clock output change requires a successor logical snapshot.

## Immutable causal cuts

```text
public_projection_causal_cuts
  PK causal_cut_id
  UNIQUE cut_hash
  columns:
    evaluation_at, evaluation_date,
    destination_owner_kind, destination_owner_key,
    cutoff_event_time, cutoff_event_id,
    event_count, event_reduction_hash,
    state=building|sealed|consumed,
    cut_hash, created_at, sealed_at, consumed_at

public_projection_causal_cut_events
  PK (causal_cut_id, ordinal)
  UNIQUE causal_event_id
  columns: causal_cut_id, ordinal, causal_event_id, event_hash

public_projection_causal_cut_requests
  PK (causal_cut_id, request_key)
```

A primary read freezes evaluation time, date, owner, cutoff, and every unassigned event at or below the cutoff. Events sort by event time and event ID. Sealing assigns every event once and verifies count and reduction. Request construction inserts the complete request-link set and consumes the cut in one guarded transaction. Promotion acknowledges consumed cuts and emits successor events.

`destination_owner_kind` accepts `projection_successor`, `source_global_successor`, `emergency_successor`, and `scheduled_expiry_successor`. The writer assigns the owner. Self-loop suppression applies only to the same manifest, subject, successor version, and successor hash.

## Acceptance requirements

Independent acceptance covers:

- active and tombstone exclusivity, deterministic ordering, and reductions;
- atomic pointer and temporal-snapshot pairing;
- current, cursor, ETag, sitemap, and `JobPosting` snapshot coherence;
- pending authoring with byte-identical public output;
- exact selected-target activation and empty-selection behavior;
- exhaustive reverse closure, including aliases and redirect roots;
- source-global plans above 25 roots under an admitting limits artifact;
- oversize quarantine preserving effective and catalog heads;
- emergency filtered and quarantine successors, replay, and stale predecessors;
- every authority expiry kind, D1-time lease races, and wall-clock backstop;
- causal assignment uniqueness, coalesced request links, consumed cuts, and exact self-loop suppression; and
- current views that expose one complete predecessor or successor snapshot.
