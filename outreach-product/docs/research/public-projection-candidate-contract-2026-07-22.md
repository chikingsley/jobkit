# Public projection contract family

**Status:** Canonical module index for `PUBLIC-CANDIDATE-001`\
**Contract generation:** v4 modular reconciliation\
**Contract date:** 2026-07-22

## Outcome

The former candidate v4 monolith is replaced by four focused contracts. This index defines ownership, dependency order, implementation readiness, and the completion rule. It contains no implementation mechanics.

`PUBLIC-CANDIDATE-001` completes after modules A through D have independent acceptance, implementation evidence, and an end-to-end integration packet. Module A can implement after its own acceptance while modules B through D remain design contracts.

## Contract modules

| Module | Contract                                                                         | Status                                                          | Exclusive authority                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | [Candidate core](public-projection-candidate-core-contract-2026-07-22.md)        | Current implementation contract; independent acceptance pending | Immutable requests, shadow generations and facts, dependency closure, current-policy gating, source selection, lifecycle outcomes, canonical candidate identity, accepted bindings, and seals |
| B      | [Application authority](public-application-authority-contract-2026-07-22.md)     | Design contract pending independent acceptance                  | Public route state, contacts, destinations, verification, employer authority, opaque authority snapshots, and legacy attempt migration                                                        |
| C      | [Catalog and temporal authority](public-catalog-temporal-contract-2026-07-22.md) | Design contract pending independent acceptance                  | Active and tombstone catalogs, effective and pending authority targets, source-global activation, emergency revocation, scheduled expiry, causal cuts, and temporal snapshots                 |
| D      | [Promotion activation](public-promotion-activation-contract-2026-07-22.md)       | Design contract pending independent acceptance                  | Private-fact compilation, destination operations, main and auxiliary transaction plans, activation v2, and remote-D1 limits evidence                                                          |

## Dependency graph

```text
sealed D3 identity/location ─────┐
position evidence/content ──────┼──> A: candidate core
effective publication policy ───┤          │
B: application authority pin ───┘          │ accepted candidate facts
                                            v
B: route/application authority ───────────> D: promotion activation
C: catalog/temporal authority ────────────> D: promotion activation
public DTO serializers ───────────────────> D: promotion activation
                                            │
                                            v
                                   live public read model
```

Module A treats the B snapshot as an opaque typed input. This interface permits core implementation and hostile testing before B receives acceptance. Runtime publication requires an accepted B implementation and current snapshot.

Module C consumes active or tombstone fragments compiled from candidate facts. Module D consumes accepted outputs from A, B, and C and strict serializers from the public DTO contract.

## Implementation and acceptance order

1. Accept and implement module A against its shadow-only database authorizer and hostile suite.
1. Accept and implement module B, including authority snapshot determinism and the verified legacy attempt migration.
1. Accept and implement module C, including temporal coherence and independent source-global, emergency, and expiry transactions.
1. Accept and implement module D, including the exact 46-slot batch and remote D1 limits artifact.
1. Run integration fixtures from candidate request through anonymous read model, route resolution, application availability, catalog cutover, and replay.
1. Mark `PUBLIC-CANDIDATE-001` complete after every module packet passes and the integration packet demonstrates one coherent predecessor or successor state for each public surface.

## Ownership rules

1. A normative mechanic appears in one owning module. Supporting contracts link to that authority and define only their local interface.
1. Module A remains the sole current implementation contract in this family.
1. Modules B through D retain design status until their independent acceptance packets pass.
1. Candidate core writes private semantic facts. Promotion owns destination SQL and live head changes.
1. Application authority owns route and destination truth. Candidate core sees the opaque snapshot reference.
1. Catalog authority owns catalog membership, tombstones, effective authority, expiry, and temporal snapshot identity.
1. Main promotion, source-global activation, emergency revocation, scheduled expiry, lifecycle authoring, and application-authority succession retain separate counted transactions.

## Shared downstream references

- Canonical detail route: `/job/:publicId/:slug`.
- Public description renderer: `public-description-v2`.
- Canonical public DTO bytes: `public-job-json-bytes-v2`.
- Main activation: `public-promotion-activation-v2` with 46 prepared statement slots.
- Canonical live catalog names: `public_job_catalog_head_pointer`, `public_job_catalog_head_history`, and `public_job_catalog_head` as the read view.
- Canonical mapping names: `job_source_position_mapping_versions` and `job_source_position_mapping_heads`.
- Canonical decision-source name: `public_job_decision_sources`.

## Supporting contracts

- [Identity and location](public-projection-identity-location-contract-2026-07-22.md) defines the sealed D3 graph and canonical resolution inputs.
- [Public job DTO and private match](public-job-dto-and-private-match-contract-2026-07-22.md) defines anonymous and signed-in read boundaries.
- [Source publication policies](source-publication-policies-2026-07-21.md) records source-specific decisions and delegates activation mechanics to module C.
- [`PRODUCT.md`](../../PRODUCT.md) remains authoritative for product behavior and route families.
