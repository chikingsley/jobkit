# Public promotion and activation contract

**Status:** Design contract pending independent acceptance\
**Work item:** `PUBLIC-CANDIDATE-001/D`\
**Activation contract:** `public-promotion-activation-v2`\
**Contract date:** 2026-07-22

## Authority and boundary

This contract owns compilation of accepted private candidate facts into inert destination operations, promotion manifests, remote-D1 admission evidence, the counted main activation transaction, and coordination of auxiliary authority transactions.

Inputs are:

- one accepted binding and seal from the [candidate core](public-projection-candidate-core-contract-2026-07-22.md);
- one current application-authority snapshot from the [application-authority contract](public-application-authority-contract-2026-07-22.md);
- active and tombstone fragments plus temporal inputs from the [catalog contract](public-catalog-temporal-contract-2026-07-22.md); and
- strict public serializers from the [DTO contract](public-job-dto-and-private-match-contract-2026-07-22.md).

Candidate core remains semantic and shadow-only. Promotion compilation is the first stage that creates destination-table operations and catalog staging rows.

## Promotion preparation

```text
public_projection_promotion_manifests
  PK manifest_id
  UNIQUE replay_key
  columns:
    activation_contract_version,
    candidate_id, candidate_semantic_hash, candidate_seal_hash,
    accepted_run_id, accepted_component_id, accepted_generation,
    accepted_plan_hash,
    expected_dependency_digest,
    application_authority_snapshot_id,
    application_authority_snapshot_hash,
    expected_effective_authority_targets_json,
    selected_pending_authority_targets_json,
    expected_catalog_version,
    expected_catalog_temporal_snapshot_id,
    target_catalog_version,
    target_catalog_temporal_snapshot_id,
    promotion_limits_evidence_version,
    promotion_limits_evidence_hash,
    component_count, root_count,
    operation_count, operation_page_count,
    destination_row_count, destination_byte_count,
    statement_count,
    operation_digest, catalog_fragment_reduction_hash,
    plan_hash, manifest_hash, replay_key,
    state=prepared|authorized|claimed|completed|superseded|failed,
    lease_owner, lease_token, lease_epoch, lease_expires_at,
    authorized_by, authorized_at, created_at, completed_at
```

The compiler revalidates the accepted binding, canonical candidate, candidate seal, dependency digest, current application-authority snapshot, and every expected head. It maps each typed candidate fact to one destination schema. A fact with no registered destination mapping fails preparation with `promotion_fact_mapping_unregistered`.

Destination operations stage under manifest ID and page ordinal:

```text
public_projection_promotion_operation_pages
  PK (manifest_id, page_ordinal)
  columns:
    first_operation_ordinal, operation_count, page_byte_count,
    previous_page_hash, page_hash,
    state=writing|sealed, created_at, sealed_at

public_projection_promotion_operations
  PK (manifest_id, operation_ordinal)
  UNIQUE (manifest_id, operation_hash)
  columns:
    page_ordinal, phase, destination_table,
    mutation_kind, semantic_key_json,
    expected_predecessor_json, values_json,
    destination_schema_version, destination_schema_hash,
    semantic_row_byte_size, operation_hash, created_at
```

Each destination schema pins ordered primary-key, predecessor, inserted, nullable, and transport-bound columns; allowed phases; and mutation kinds. Operations reject missing, extra, reordered, or duplicated columns.

`phase` accepts exactly:

| Value | Phase                       |
| ----: | --------------------------- |
|    10 | `assert_inputs`             |
|    20 | `identity_and_routes`       |
|    30 | `content_and_bindings`      |
|    40 | `eligibility_and_decisions` |
|    50 | `advance_entity_heads`      |
|    60 | `catalog_cutover`           |
|    70 | `events_and_outbox`         |
|    80 | `terminalize_manifest`      |

`mutation_kind` accepts `assert_equal`, `insert_immutable`, `insert_or_exact`, `advance_head`, `insert_event`, and `terminalize`.

Catalog versions, active members, tombstones, DTO bytes, search documents, terms, facets, temporal snapshots, and seals stage in inert promotion-owned relations before authorization. Every staging page compares manifest token, epoch, plan hash, and an unexpired D1 server-clock lease.

## Main and auxiliary transaction ownership

The main activation transaction owns one allocation or lifecycle component and its candidate-owned catalog impact. These concerns use separate counted transactions:

| Transaction                              | Owner                          | Purpose                                                                                                   |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Main candidate activation                | This contract                  | Candidate facts to live entity, route, mapping, eligibility, optional catalog, events, and manifest state |
| Lifecycle action authoring or revocation | Candidate core                 | Append and advance lifecycle authority before candidate evaluation                                        |
| Source-global policy or label activation | Catalog contract               | Advance selected source authority and complete affected catalog                                           |
| Emergency revocation                     | Catalog contract               | Block policy and install filtered or quarantine catalog                                                   |
| Scheduled expiry                         | Catalog contract               | Advance one expired authority and coherent temporal snapshot                                              |
| Application-authority successor          | Application-authority contract | Append route, verification, contact, destination, or employer authority and snapshot                      |
| Remote limits evidence authoring         | This contract                  | Insert benchmark evidence and advance its effective head                                                  |

Each transaction has an independent manifest, replay key, lease, operation count, statement count, and terminal result. The main transaction asserts source-policy and source-label selected-target sets are empty. It may activate one exact market-registry target when its complete catalog closure is present.

## Remote-D1 limits evidence

```text
public_projection_promotion_limits_evidence
  PK evidence_version
  UNIQUE evidence_hash
  columns:
    benchmark_contract_version,
    worker_deployment_id, d1_database_id,
    d1_plan, region_set_json,
    started_at, completed_at,
    sample_count, successful_sample_count,
    p50_wall_ms, p95_wall_ms, max_wall_ms,
    statement_count,
    max_row_bytes,
    max_page_rows, max_page_bytes,
    max_destination_rows, max_destination_bytes,
    max_candidate_operations, max_candidate_pages,
    max_candidate_rows, max_candidate_bytes,
    max_manifest_components, max_manifest_roots,
    max_manifest_operations, max_manifest_rows, max_manifest_bytes,
    max_source_global_roots_per_page,
    max_source_global_affected_roots,
    max_description_evidence_entries,
    max_catalog_terms_per_fragment,
    max_catalog_facets_per_fragment,
    raw_evidence_artifact_uri, raw_evidence_sha256,
    evidence_hash, created_at

public_projection_promotion_limits_effective_head
  PK singleton=1
  columns: evidence_version, evidence_hash, updated_at
```

Only the remote benchmark writer inserts an artifact or advances the head. It executes the exact 46-slot batch through a deployed preview Worker and remote D1, exercises each admitted row, page, destination, candidate, manifest, and source-global bound, and records injected rollback evidence.

Every promotion manifest pins the effective limits version and hash. Admission is unavailable when the pin differs from the effective head. Documented D1 platform ceilings remain hard outer bounds; the evidence artifact supplies the lower operational limits admitted by JobKit.

`semanticRowByteSize` is the byte length of `semanticEncodeV3` over every persisted value in migration-column order. Totals include exact row bytes and registered operation-envelope bytes. An indivisible allocation component that exceeds an admitted bound fails with `promotion_component_too_large`. A manifest may split only between complete candidates. Source-global plans use their separate artifact-backed root and page limits.

## Counted 46-slot main activation

Conditional statements execute a guarded zero-row statement and retain their slot:

| Slot | Purpose                                                                 |
| ---: | ----------------------------------------------------------------------- |
|    1 | Assert manifest state, authorization, lease token, and epoch            |
|    2 | Assert accepted generation, candidate ID, and seal hash                 |
|    3 | Assert candidate dependency digest and current dependency heads         |
|    4 | Assert content, route-state, mapping, and eligibility predecessors      |
|    5 | Assert application-authority snapshot and every selected authority head |
|    6 | Assert source-open, origin, analysis, evidence, and resolution heads    |
|    7 | Assert effective policy and label heads                                 |
|    8 | Assert employer-authority and lifecycle-action heads                    |
|    9 | Assert conditional catalog and market-registry predecessors             |
|   10 | Insert or reuse `canonical_locations`                                   |
|   11 | Insert or reuse `public_jobs`                                           |
|   12 | Insert or reuse `public_job_allocations`                                |
|   13 | Insert `public_job_route_versions`                                      |
|   14 | Insert `public_job_aliases`                                             |
|   15 | Insert `public_job_versions`                                            |
|   16 | Insert `public_job_version_locations`                                   |
|   17 | Insert `job_source_position_mapping_versions`                           |
|   18 | Insert public identity signals                                          |
|   19 | Insert canonical-source bindings                                        |
|   20 | Insert field-source bindings                                            |
|   21 | Insert resolution-source bindings                                       |
|   22 | Insert source attributions                                              |
|   23 | Insert description evidence sets                                        |
|   24 | Insert description evidence entries                                     |
|   25 | Insert verbatim checks                                                  |
|   26 | Insert eligibility decisions                                            |
|   27 | Insert `public_job_decision_sources`                                    |
|   28 | Advance `public_job_heads`                                              |
|   29 | Advance `public_job_route_heads`                                        |
|   30 | Advance `job_source_position_mapping_heads`                             |
|   31 | Advance `public_job_eligibility_heads`                                  |
|   32 | Assert source-policy selected targets are empty                         |
|   33 | Assert source-label selected targets are empty                          |
|   34 | Advance the selected effective market-registry head                     |
|   35 | Insert `public_job_catalog_head_history` when catalog impact exists     |
|   36 | Advance `public_job_catalog_head_pointer` when catalog impact exists    |
|   37 | Insert reverse-dependency rows                                          |
|   38 | Acknowledge consumed causal cuts and request links                      |
|   39 | Append public-job events                                                |
|   40 | Append work-outbox events                                               |
|   41 | Append manifest-owned causal successor events                           |
|   42 | Mark the promotion manifest completed                                   |
|   43 | Assert immutable destination insert counts                              |
|   44 | Assert exact head-advance counts                                        |
|   45 | Assert catalog, authority, and market activation counts                 |
|   46 | Assert event, outbox, and manifest terminal counts                      |

Immutable inserts use fixed-column `INSERT ... SELECT` from sealed staging. Assertions use guard relations that raise a `CHECK` failure on mismatch. Every head update names its expected predecessor. Employer and lifecycle heads are assertion-only upstream dependencies. Slot 36 changes zero rows for an entity-only manifest. Slot 34 changes zero rows when its selected market target is empty. The activation invocation performs exactly these 46 statements.

## Authorization and execution

Authorization pins manifest hash, accepted candidate seal, limits evidence, application-authority snapshot, expected authority targets, catalog predecessor, operation and fragment reductions, statement count, and authorized operator.

Claim uses D1 server time, fresh token, incremented epoch, and an expiry. Main activation compares token, epoch, and `lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`. The same replay key returns the stored terminal result. Drift before commit changes the manifest to superseded and writes zero live mutations.

The 46 statements execute through one D1 transactional `batch()`. Any statement failure rolls back the complete batch. Completion records exact head advances, events, outbox rows, and activation result.

## Remote evidence gate

Before live publication enablement:

1. Deploy the exact candidate compiler and 46-slot executor to a preview Worker.
1. Seed remote D1 at each proposed component, root, row, page, operation, statement, and byte bound.
1. Run at least 30 complete activations and the rollback injection matrix.
1. Record Worker request ID, D1 metadata, rows read and written, SQL duration, wall duration, database size, statement count, and terminal state.
1. Require complete transactional success for admitted fixtures, complete rollback for injected failures, duration within the platform ceiling, and the product's recorded p95 admission threshold.
1. Store raw evidence in immutable object storage, insert the evidence artifact, and advance its head through the benchmark-authoring transaction.

Local SQLite and Miniflare runs prove semantics and supply diagnostics. Remote D1 evidence controls publication authorization.

## Acceptance requirements

Independent acceptance covers:

- exact candidate-fact-to-destination mappings and rejection of unmapped facts;
- operation schema, ordering, page chaining, and byte reductions;
- canonical live names and expected predecessor assertions;
- all 46 statement slots, including every guarded zero-row branch;
- main source-policy and source-label empty selections;
- optional exact market-registry activation;
- entity-only and catalog-impact components;
- application-authority, dependency, catalog, and limits drift;
- lease token, epoch, expiry, replay, and concurrent claimant races;
- injected failures at every slot with complete rollback;
- remote limits evidence provenance and effective-head mismatch;
- components at every admitted edge and one unit beyond each edge; and
- before-and-after live relation, catalog pointer, event, outbox, and manifest digests.
