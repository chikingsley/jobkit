# Public projection candidate core contract

**Status:** Frozen implementation contract; pending independent acceptance\
**Work item:** `PUBLIC-CANDIDATE-001/A`\
**Contract date:** 2026-07-22\
**Correction basis:** Rejected independent audit packet SHA-256 prefixes `d87f5ad4` and `61b269bf`

## Authority and outcome

This document is the only current implementation contract in the public projection contract family. It defines deterministic construction of immutable, private candidate facts. The implementation may begin after independent acceptance of this contract.

The core consumes sealed upstream identity, content, policy, lifecycle, and application-authority inputs. It produces one accepted candidate binding or one immutable terminal result for each allocation or lifecycle component. Candidate construction relations are private shadow state. Source-position version authority and lifecycle action authority are separate private control-plane writers defined here because their sealed versions are core inputs. Live public rows, catalog membership, route tables, authority activation, and promotion execution belong to downstream modules.

The core owns:

- immutable requests and component scope;
- generation, page, lease, and retry state;
- pre-materialization plan hashing followed by candidate identity derivation;
- dependency closure and drift detection;
- policy-independent D3 organization and location inputs;
- current-effective-policy field gating;
- validation and consumption of sealed position-scoped analyses, evidence, and authored descriptions;
- primary source and optional-field fallback selection;
- per-root lifecycle outcomes, including zero-source terminal roots;
- typed candidate facts and their exact hashes;
- blocked, failed, superseded, and successful seals; and
- accepted per-run bindings to canonical candidates.

The following contracts own downstream concerns:

- [Application authority](public-application-authority-contract-2026-07-22.md) owns route, contact, destination, verification, and employer authority.
- [Catalog and temporal authority](public-catalog-temporal-contract-2026-07-22.md) owns active and tombstone catalogs, authority-head activation, emergency revocation, and scheduled expiry.
- [Promotion activation](public-promotion-activation-contract-2026-07-22.md) owns compilation of accepted facts into live operations and every D1 activation transaction.
- [Identity and location](public-projection-identity-location-contract-2026-07-22.md) owns the sealed D3 graph and canonical resolution algorithms.
- [Public DTO](public-job-dto-and-private-match-contract-2026-07-22.md) owns anonymous transport and rendering.

## Fixed boundaries

1. Candidate-worker writes target `public_projection_*` shadow relations only. Source-position version authority and lifecycle authority have separate relation allowlists and transaction entry points.
1. Candidate facts express semantic outcomes rather than SQL destination rows.
1. Candidate staging contains zero foreign keys to live catalog, route, destination, contact, or application-attempt relations.
1. Core evaluates the current effective source policies and labels pinned by the request. Pending authority targets stay outside candidate construction.
1. Application authority arrives as one opaque immutable snapshot reference. An absent, unavailable, expired, or stale reference produces a private root with an exact reason code.
1. `/job/:publicId/:slug` and `public-description-v2` are downstream contracts. Core pins canonical path intent and seals exact visible prose bytes; downstream owners publish routes and wrap those bytes in transport or presentation without rewriting them.
1. Decimal transport uses canonical decimal strings. Semantic hashing uses an arbitrary-precision decimal type created from that string. JavaScript binary numbers are rejected for decimal fields.

## Core limits v1

`public-candidate-core-limits-v1` fixes every admission boundary. A successor identifier and migration are required to change a value.

| Boundary                                           | Exact admitted maximum | N+1 reason                             |
| -------------------------------------------------- | ---------------------: | -------------------------------------- |
| Runs for one request key                           |                     16 | `core_limit_request_runs`              |
| UTF-8 bytes in canonical request payload           |              1,048,576 | `core_limit_request_bytes`             |
| Boards in request scope                            |                     64 | `core_limit_request_boards`            |
| Listing IDs in request scope                       |                 10,000 | `core_limit_request_listings`          |
| Public job IDs in request scope                    |                 10,000 | `core_limit_request_public_jobs`       |
| Root intents in request                            |                 10,000 | `core_limit_request_root_intents`      |
| Effective authority heads in request               |                  2,048 | `core_limit_request_authorities`       |
| Scope entries in one request-scope page            |                    256 | `core_limit_scope_page_entries`        |
| UTF-8 bytes in one request-scope page              |                 65,536 | `core_limit_scope_page_bytes`          |
| Components in one run                              |                 10,000 | `core_limit_run_components`            |
| Roots in one component                             |                     25 | `core_limit_component_roots`           |
| UTF-8 bytes in one canonical component             |                262,144 | `core_limit_component_bytes`           |
| Dependency members in one component generation     |                  4,096 | `core_limit_dependencies`              |
| UTF-8 bytes in one dependency member               |                 16,384 | `core_limit_dependency_member_bytes`   |
| Dependency members in one dependency page          |                    256 | `core_limit_dependency_page_entries`   |
| UTF-8 bytes in one dependency page                 |                 65,536 | `core_limit_dependency_page_bytes`     |
| Total encoded dependency bytes                     |              8,388,608 | `core_limit_dependency_bytes`          |
| Facts in one component generation                  |                  8,192 | `core_limit_facts`                     |
| Natural-key fields in one fact                     |                      4 | `core_limit_fact_key_fields`           |
| UTF-8 bytes in one natural-key field               |                  1,024 | `core_limit_fact_key_bytes`            |
| Evidence references in one fact                    |                    256 | `core_limit_fact_evidence_refs`        |
| UTF-8 bytes in one canonical fact envelope         |                262,144 | `core_limit_fact_bytes`                |
| Total encoded fact bytes                           |              8,388,608 | `core_limit_fact_total_bytes`          |
| Fact pages in one component generation             |                  8,192 | `core_limit_fact_pages`                |
| UTF-8 bytes in one fact-page record                |                327,680 | `core_limit_fact_page_bytes`           |
| Reason codes in one outcome or terminal seal       |                     64 | `core_limit_reason_codes`              |
| UTF-8 bytes in one reason code                     |                    128 | `core_limit_reason_code_bytes`         |
| Artifacts in one terminal reduction                |                  8,192 | `core_limit_artifacts`                 |
| Total encoded terminal-artifact bytes              |              8,388,608 | `core_limit_artifact_bytes`            |
| Sections in one authored description               |                      9 | `core_limit_description_sections`      |
| Blocks in one authored description                 |                    128 | `core_limit_description_blocks`        |
| Bullet items in one authored description           |                    256 | `core_limit_description_bullets`       |
| Evidence ordinals in one description block or item |                    256 | `core_limit_description_evidence_refs` |
| UTF-8 bytes in one description text value          |                 16,384 | `core_limit_description_text_bytes`    |
| UTF-8 bytes in canonical description JSON          |                262,144 | `core_limit_description_bytes`         |
| Bound variables in one prepared statement          |                     90 | `core_limit_statement_binds`           |
| UTF-8 bytes in one SQL statement                   |                 90,000 | `core_limit_statement_sql_bytes`       |
| Statements in one core D1 transaction              |                     20 | `core_limit_transaction_statements`    |
| Encoded bound-value bytes in one transaction       |              1,048,576 | `core_limit_transaction_bind_bytes`    |
| Encoded row bytes in one inserted row              |              1,048,576 | `core_limit_row_bytes`                 |
| Encoded bytes written by one transaction           |              8,388,608 | `core_limit_transaction_write_bytes`   |

Counts use SQLite integers and canonical integer strings at JSON boundaries. Byte counts are UTF-8 lengths of the exact canonical payload or `semanticEncodeV3` output named by the row. The lower applicable limit wins. A request, component, member, fact, page, seal, statement, or transaction is admitted only after every applicable count and byte check passes.

Request scope and dependency pages use one canonical JSON page as a single bind and `json_each` to insert at most 256 normalized rows. Fact pages contain one fact. Every domain mutation is followed by its mutation-coupled operation-specific assertion; read guards occupy declared assertion-only slots. All transaction statement counts include context, mutation, assertion, and receipt statements.

Boundary accounting is exact:

- `row bytes` is the byte length of `semanticEncodeV3` over a record containing every inserted column in migration order, including null fields;
- `bound-value bytes` is the sum of `LP(semanticEncodeV3(boundValue))` for every placeholder occurrence in the transaction;
- `transaction write bytes` is the sum of encoded row bytes for inserted rows plus old and new encoded row bytes for updated rows;
- `statement SQL bytes` is the UTF-8 byte length after selecting the fixed SQL template and before binding; and
- JSON/page bytes always count the complete canonical envelope stored in the row. A one-fact page receives both fact-envelope and page-envelope checks.

The acceptance suite generates two fixtures for every Core limits v1 row. The fixture names are `CL-<reason-code>-N` and `CL-<reason-code>-N-plus-1`. The N fixture sets the named quantity to the exact maximum while keeping all other quantities at their smallest valid value and must seal. The N-plus-1 fixture adds one count or one UTF-8 byte to that same quantity and must write zero child, page, candidate, seal, or binding rows while returning that row's reason code. Statement, bind, row, and transaction fixtures execute through the real D1 repository. Request, component, dependency, fact, page, reason, artifact, and description fixtures execute through both the schema validator and real D1 repository.

## Core algorithm bundle

Every request, generation, fact page, candidate, and seal pins this ordered bundle:

1. `jobkit-semantic-value-v3`
1. `jobkit-canonical-json-v1`
1. `public-hash-schema-registry-v1`
1. `public-candidate-core-limits-v1`
1. `public-candidate-request-key-v4`
1. `public-candidate-request-persistence-v3`
1. `public-candidate-component-v5`
1. `public-candidate-component-id-v1`
1. `public-candidate-plan-v4`
1. `public-projection-dependency-closure-v3`
1. `public-position-evidence-set-v2`
1. `public-source-position-version-authority-v1`
1. `public-root-outcome-v3`
1. `public-candidate-lifecycle-v5`
1. `public-field-policy-selection-v1`
1. `public-source-origin-v1`
1. `public-content-source-selection-v3`
1. `public-field-fallback-v3`
1. `public-source-url-sanitizer-v1`
1. `public-verbatim-overlap-v1`
1. `public-description-builder-v3`
1. `public-description-visible-renderer-v1`
1. `public-description-authored-artifact-v1`
1. `public-candidate-fact-v1`
1. `public-candidate-fact-page-v1`
1. `public-candidate-semantic-hash-v4`
1. `public-candidate-seal-v4`
1. `public-lifecycle-action-v2`
1. `public-counted-transaction-v2`

An algorithm change creates a successor identifier and a new request. Historical artifacts retain the exact pinned bundle.

## Typed semantic values

`jobkit-semantic-value-v3` accepts values after strict schema validation. Every required nullable field is present, optional fields are declared by the schema, and extra fields fail validation.

| Type    | Exact encoding                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| null    | ASCII `n`                                                                                                                              |
| Boolean | ASCII `f` or ASCII `t`                                                                                                                 |
| string  | ASCII `s`, decimal UTF-8 byte length without leading zeroes, `:`, exact UTF-8 bytes                                                    |
| integer | ASCII `i`, decimal lexical byte length, `:`, then `0` or `-?[1-9][0-9]*`                                                               |
| decimal | ASCII `d`, decimal lexical byte length, `:`, then canonical decimal text                                                               |
| array   | ASCII `a`, element count, `:`, then each child as an eight-byte unsigned big-endian length and child bytes                             |
| record  | ASCII `o`, field count, `:`, then each field name and value as separate eight-byte unsigned big-endian length-prefixed semantic values |

Canonical decimal text matches `0|-?(?:0\.[0-9]*[1-9]|[1-9][0-9]*(?:\.[0-9]*[1-9])?)`. The canonical producer expands exponent input, removes trailing fractional zeroes, and maps signed zero to `0` before boundary validation. Transport schemas declare decimal values as strings:

```ts
type CanonicalDecimalText = string & {
  readonly __canonicalDecimalText: unique symbol;
};

type DecimalTransportV1 = {
  decimal: CanonicalDecimalText;
};
```

The boundary parser accepts JSON strings matching the canonical grammar and constructs an arbitrary-precision decimal. It rejects JSON numbers, `NaN`, infinities, exponent text, leading plus signs, leading zeroes, and fractional trailing zeroes. D1 stores the canonical text in `TEXT` columns. Integer counts and versions use SQLite `INTEGER` when they remain within the signed 64-bit range; JSON transport renders unsafe JavaScript integers as canonical integer strings under their declared schema.

Strings contain Unicode scalar values encoded with Unicode 16.0.0. Unpaired surrogates fail validation. Record fields use registered order. Set-like arrays deduplicate and sort by encoded child bytes; sequence arrays preserve declared order. Dates use `YYYY-MM-DD`. Instants use UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`.

`LP(x)` means an eight-byte unsigned big-endian byte length followed by `x`. `INT(n)` means the semantic integer encoding. Hash storage uses lowercase hexadecimal; formulas consume raw 32-byte digests.

### Canonical JSON for every stored JSON value

`jobkit-canonical-json-v1` is the one serializer for every request, scope, dependency, plan, lifecycle payload, description, fact, page, artifact, and reason JSON column. An implementation parses into a schema-validated semantic value first and emits these exact bytes:

- The admitted JSON value kinds are object, array, string, Boolean, and null. JSON number tokens fail admission. Integer and decimal schema values are canonical strings before serialization.
- Object keys are unique Unicode-scalar strings sorted by exact UTF-8 bytes. Duplicate keys fail during token parsing, before construction of a language object. Every schema-required nullable key appears with null; absent optional keys follow the closed schema and extra keys fail validation.
- Arrays preserve sequence order. A schema-declared set array first deduplicates by `semanticEncodeV3` child bytes and sorts by those bytes. Empty arrays and objects serialize as `[]` and `{}`.
- Strings preserve their exact scalar sequence without normalization. The quote and reverse-solidus use `\"` and `\\`. Scalars U+0000 through U+001F use lowercase six-byte `\u00xx` escapes. Solidus remains `/`; all other scalars, including U+2028 and U+2029, are emitted as UTF-8.
- Boolean and null tokens are `true`, `false`, and `null`. No whitespace, trailing comma, byte-order mark, undefined value, non-finite value, surrogate, or implementation-specific escape is admitted.

Every `*_json` column named in this contract stores these bytes as UTF-8 text. Every hash over JSON either consumes those exact bytes through a registered bytes hash or consumes the schema-validated semantic value through its registered record hash. Parsing and reserializing a stored JSON value must return byte-identical output.

The coverage map is closed:

| Stored JSON family                                            | Exact canonical root                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Request payload, legacy scope, and watermark                  | Declared request, scope, or legacy watermark schema                          |
| Scope and dependency pages                                    | Complete page envelope, including ordered member hashes                      |
| Component and plan                                            | Complete `ComponentV5` or `CandidatePlanV4` record                           |
| Policy, source, evidence, lifecycle, and description payloads | The exact versioned record declared by that relation                         |
| Fact value, natural key, evidence refs, and fact envelope     | `CandidateFactEnvelopeV1` and its declared child schemas                     |
| Fact page and terminal artifacts                              | Complete page or artifact envelope in registered field order                 |
| Reason arrays                                                 | Deduplicated `CoreReasonCodeV1` values sorted by reason rank and UTF-8 bytes |

Cross-runtime acceptance uses these literal UTF-8 vectors:

| Semantic value                                                           | Canonical bytes                                                                                                       | SHA-256                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Object inserted as keys `b`,`a`, with `a=U+00E9` and `b=["2",null,true]` | `{"a":"é","b":["2",null,true]}`                                                                                       | `ddefaeb2c95606e4cbd3d82eaf0442ef7f68d1150b4e0b066f55f5181ca4c3fb` |
| Object with newline control scalar and solidus                           | `{"control":"\u000a","slash":"/"}`                                                                                    | `fae416dfc978e58e946fd8e6ede3db19641b1a86c9419a6f193d3827af73708a` |
| String U+00E9                                                            | `{"s":"é"}`                                                                                                           | `86028b41ba792eaf82aa26a45b218f6734f7f1096a86f1746c8296e088a0ccb4` |
| String U+0065 U+0301                                                     | `{"s":"é"}`                                                                                                           | `1fc0bd7cc93fca8092a2041d7d01842876422aa7e2838acf42c14578e9f2be05` |
| Minimal `DescriptionSectionsV1`                                          | `{"sections":[{"blocks":[{"evidenceEntryOrdinals":["0"],"kind":"paragraph","text":"Teach."}],"section":"overview"}]}` | `0e3cbce923de1b2a183cd74df09c4de089901796edf0fff5590ed8c78333b650` |

The final two vectors prove that canonical JSON preserves scalar identity rather than applying Unicode normalization. TypeScript, Go, Rust, and SQLite fixture producers must match the bytes and digests above.

## Exact core hash registry

The core migration installs immutable registry rows before accepting any v4 request:

```text
public_hash_schema_registry
  PK hash_name
  UNIQUE domain_tag
  columns:
    hash_name,
    hash_kind=record|reduction|bytes|identifier,
    domain_tag,
    typed_schema_name,
    typed_schema_version,
    ordering_rule,
    reduction_rule,
    output_encoding=raw32_and_lower_hex|lower_hex|utf8_identifier,
    identifier_prefix,
    schema_definition_json,
    schema_definition_hash,
    created_at
```

The bootstrap definition hash is independent of the registry being installed:

```text
schemaDefinitionHash(rowWithoutSchemaDefinitionHash) =
  SHA256(
    ASCII("jobkit-public-hash-schema-definition/v1") || NUL ||
    LP(canonicalJsonV1(rowWithoutSchemaDefinitionHash))
  )
```

It covers `hash_name`, `hash_kind`, `domain_tag`, `typed_schema_name`, `typed_schema_version`, `ordering_rule`, `reduction_rule`, `output_encoding`, `identifier_prefix`, and `schema_definition_json` in that canonical object. The formulas for admitted rows are:

```text
registeredRecordHash(name, value) =
  SHA256(
    ASCII(registry[name].domain_tag) || NUL ||
    LP(semanticEncodeV3(value under registry[name].typed_schema))
  )

registeredReductionHash(name, orderedRaw32Values) =
  SHA256(
    ASCII(registry[name].domain_tag) || NUL ||
    LP(INT(count)) ||
    LP(orderedRaw32Values[0]) || ... ||
    LP(orderedRaw32Values[count - 1])
  )

registeredBytesHash(name, valueBytes) =
  SHA256(
    ASCII(registry[name].domain_tag) || NUL ||
    LP(INT(byteCount)) || LP(valueBytes)
  )

registeredIdentifier(name, recordHash) =
  ASCII(registry[name].identifier_prefix) ||
  ASCII(lowerHex(recordHash))
```

An empty reduction includes `LP(INT(0))`. Each reduction child is exactly 32 raw bytes. A missing registry row, schema mismatch, ordering mismatch, or output encoding mismatch blocks the generation with `hash_schema_unregistered` or `hash_schema_mismatch`.

The complete core registry is:

| Persisted hash or identifier              | Registry name                          | Kind       | Typed schema or ordering                                                                     |
| ----------------------------------------- | -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `algorithm_bundle_hash`                   | `algorithmBundleHash`                  | record     | Ordered bundle identifiers                                                                   |
| request digest                            | `requestKeyHash`                       | record     | `ProjectionCandidateRequestV4` in declared field order                                       |
| `request_key`                             | `requestKey`                           | identifier | Prefix `prequest_v4_` over `requestKeyHash`                                                  |
| migration-0049 request digest             | `legacy0049RequestHash`                | record     | Exact immutable migration-0049 request fields                                                |
| migration-0049 scope JSON                 | `legacy0049ScopeJsonHash`              | bytes      | Canonical validated migration-0049 scope JSON bytes                                          |
| migration-0049 watermark JSON             | `legacy0049WatermarkJsonHash`          | bytes      | Canonical validated migration-0049 source-watermark JSON bytes                               |
| request-scope member                      | `requestScopeMemberHash`               | record     | Scope kind and scope key                                                                     |
| `request_scope_digest`                    | `requestScopeDigest`                   | reduction  | Scope members ordered by scope kind and scope key                                            |
| `scope_expansion_digest`                  | `requestScopeExpansionDigest`          | reduction  | Added scope members ordered by scope kind and scope key                                      |
| request-scope page-zero predecessor       | `requestScopePageZeroPredecessorHash`  | record     | Request hash                                                                                 |
| request-scope page                        | `requestScopePageHash`                 | record     | Page bounds, prior page hash, and ordered member hashes                                      |
| `component_hash`                          | `componentHash`                        | record     | Component kind, allocation state and reason, allocation hash, ordered root IDs               |
| `component_id`                            | `componentId`                          | identifier | Prefix `pcomp_v5_` over `componentHash`                                                      |
| counted template slot                     | `coreTemplateSlotHash`                 | record     | Template, ordinal, operation, target kind, bounds, schemas, and SQL hashes                   |
| counted template                          | `coreTemplateHash`                     | reduction  | Slot hashes by integer slot ordinal                                                          |
| counted transaction scope key             | `coreTransactionScopeKeyHash`          | bytes      | Canonical transaction scope-key JSON bytes                                                   |
| counted target key                        | `coreTargetKeyHash`                    | bytes      | Canonical operation target-key JSON bytes                                                    |
| counted mutation witness                  | `coreMutationWitnessHash`              | record     | Transaction, template, slot, slot hash, and target-key hash                                  |
| `dependency_hash`                         | `dependencyMemberHash`                 | record     | Kind, key, version, hash                                                                     |
| `dependency_digest`                       | `dependencyDigest`                     | reduction  | Dependency member hashes ordered by kind, key, version, hash bytes                           |
| dependency page-zero predecessor          | `dependencyPageZeroPredecessorHash`    | record     | Generation identity and request key                                                          |
| dependency page                           | `dependencyPageHash`                   | record     | Page bounds, prior page hash, and ordered member hashes                                      |
| root leaf                                 | `rootSetLeafHash`                      | record     | Public job ID                                                                                |
| `root_set_digest`                         | `rootSetDigest`                        | reduction  | Root leaves ordered by public job ID UTF-8 bytes                                             |
| `application_authority_snapshot_pin_hash` | `applicationAuthoritySnapshotPinHash`  | record     | Snapshot ID, snapshot hash, state, effective time, expiry                                    |
| position payload JSON                     | `positionPayloadHash`                  | bytes      | Canonical validated source-position payload JSON bytes                                       |
| `analysis_hash`                           | `analysisHash`                         | record     | Position analysis schema                                                                     |
| analysis JSON                             | `analysisOutputHash`                   | bytes      | Canonical validated analysis JSON bytes                                                      |
| `match_fact_hash`                         | `matchFactHash`                        | record     | Position match-fact schema                                                                   |
| match-fact JSON                           | `matchFactsJsonHash`                   | bytes      | Canonical validated match-fact JSON bytes                                                    |
| `source_text_hash`                        | `sourceTextHash`                       | bytes      | Exact source text UTF-8 bytes                                                                |
| `output_text_hash`                        | `outputTextHash`                       | bytes      | Exact authored output UTF-8 bytes                                                            |
| `source_excerpt_hash`                     | `sourceExcerptHash`                    | bytes      | Exact source UTF-8 bytes                                                                     |
| `claim_hash`                              | `claimHash`                            | record     | Evidence claim schema                                                                        |
| normalized claim JSON                     | `normalizedClaimJsonHash`              | bytes      | Canonical validated normalized-claim JSON bytes                                              |
| `evidence_entry_hash`                     | `evidenceEntryHash`                    | record     | Complete position evidence entry                                                             |
| `evidence_hash`                           | `evidenceHash`                         | record     | Strict evidence record for lifecycle, origin, or attribution                                 |
| evidence payload JSON                     | `evidencePayloadHash`                  | bytes      | Canonical validated evidence-payload JSON bytes                                              |
| `evidence_set_hash`                       | `evidenceSetHash`                      | reduction  | Evidence entry hashes by ordinal                                                             |
| `assertion_hash`                          | `assertionHash`                        | record     | Typed field assertion                                                                        |
| assertion value JSON                      | `assertionValueJsonHash`               | bytes      | Canonical validated assertion-value JSON bytes                                               |
| `field_policy_input_hash`                 | `fieldPolicyInputHash`                 | record     | Effective policy, label, source-open, material, and evidence input                           |
| `source_open_hash`                        | `sourceOpenHash`                       | record     | Immutable source-position openness version                                                   |
| source-open evidence                      | `sourceOpenEvidenceHash`               | record     | Exact legacy or successor source-open observation                                            |
| `decision_hash`                           | `fieldDecisionHash`                    | record     | Current effective policy decision                                                            |
| `field_decision_digest`                   | `fieldDecisionDigest`                  | reduction  | Decisions by public job ID, field, source position                                           |
| `origin_assertion_hash`                   | `sourceOriginHash`                     | record     | Source-origin predicates, evidence, and terminal class                                       |
| source-selection child                    | `sourceSelectionHash`                  | record     | Ranked source selection result                                                               |
| `source_selection_digest`                 | `sourceSelectionDigest`                | reduction  | Selection children by public job ID                                                          |
| source-binding child                      | `sourceBindingHash`                    | record     | Fact kind, natural key, source position, assertion hash                                      |
| `source_binding_digest`                   | `sourceBindingDigest`                  | reduction  | Bindings by fact kind and natural key                                                        |
| fallback child                            | `fallbackEnvelopeHash`                 | record     | Exact optional-field envelope                                                                |
| fallback envelope JSON                    | `fallbackEnvelopeJsonHash`             | bytes      | Canonical validated fallback-envelope JSON bytes                                             |
| `fallback_digest`                         | `fallbackDigest`                       | reduction  | Date-posted, valid-through, compensation order                                               |
| `sections_hash`                           | `descriptionSectionsHash`              | bytes      | Canonical authored-description section JSON bytes                                            |
| `artifact_hash`                           | `descriptionArtifactHash`              | record     | Authored-description version                                                                 |
| `description_artifact_digest`             | `descriptionArtifactDigest`            | reduction  | Selected artifacts by public job ID                                                          |
| `sanitized_url_hash`                      | `sanitizedSourceUrlHash`               | bytes      | Exact sanitizer output UTF-8 bytes                                                           |
| `verbatim_check_hash`                     | `verbatimCheckHash`                    | record     | Source/output hashes, overlap offsets and length, limit, and result                          |
| `action_hash`                             | `lifecycleActionHash`                  | record     | Lifecycle action fields declared below                                                       |
| `revocation_hash`                         | `lifecycleRevocationHash`              | record     | Lifecycle revocation fields declared below                                                   |
| lifecycle causal event                    | `lifecycleCausalEventHash`             | record     | Exact action or revocation causal-event payload                                              |
| lifecycle causal-event ID                 | `lifecycleCausalEventId`               | identifier | Prefix `plce_v1_` over `lifecycleCausalEventHash`                                            |
| lifecycle event payload JSON              | `lifecycleEventPayloadJsonHash`        | bytes      | Exact canonical lifecycle event or outbox payload JSON bytes                                 |
| lifecycle outbox payload                  | `lifecycleOutboxPayloadHash`           | record     | Event ID, event hash, topic, and exact payload hash                                          |
| `outcome_hash`                            | `rootOutcomeHash`                      | record     | `RootOutcomeV3`                                                                              |
| `root_outcome_digest`                     | `rootOutcomeDigest`                    | reduction  | Outcomes ordered by public job ID                                                            |
| `fact_hash`                               | `candidateFactHash`                    | record     | `CandidateFactEnvelopeV1`                                                                    |
| `natural_key_hash`                        | `candidateFactNaturalKeyHash`          | record     | Fact kind and the kind-specific ordered natural-key fields                                   |
| `fact_digest`                             | `candidateFactDigest`                  | reduction  | Facts ordered by kind and natural-key bytes                                                  |
| page-zero predecessor                     | `candidateFactPageZeroPredecessorHash` | record     | Plan hash                                                                                    |
| `page_hash`                               | `candidateFactPageHash`                | record     | Page ordinal, bounds, prior page hash, ordered fact hashes                                   |
| `page_digest`                             | `candidateFactPageDigest`              | reduction  | Page hashes by page ordinal                                                                  |
| terminal artifact child                   | `terminalArtifactLeafHash`             | record     | Artifact kind, artifact key, artifact hash                                                   |
| `artifact_digest`                         | `terminalArtifactDigest`               | reduction  | Artifact leaves ordered by artifact kind and key bytes                                       |
| `plan_hash`                               | `planHash`                             | record     | `CandidatePlanV4`                                                                            |
| `candidate_semantic_hash`                 | `candidateSemanticHash`                | record     | `CandidateSemanticPayloadV4`                                                                 |
| `candidate_id`                            | `candidateId`                          | identifier | Prefix `pcand_v4_` over `candidateSemanticHash`                                              |
| `seal_hash`                               | `candidateSealHash`                    | record     | Candidate ID, semantic hash, dependency, outcome, fact, and page reductions                  |
| `terminal_seal_hash`                      | `candidateTerminalSealHash`            | record     | Terminal state, generation, dependencies, roots, reasons, and accumulated artifact reduction |
| display-label version                     | `publicSourceDisplayLabelVersionHash`  | record     | Source key, version, predecessor version, display label, created time                        |

### Executable registry definitions

`schema_definition_json` is a complete, reference-free `PublicHashDefinitionV1` value. Its keys are `metaVersion`, `hashKind`, `input`, `sort`, `reduction`, `output`, and `identifierPrefix`. `metaVersion` is `1`. `input` is one recursively inlined `TypeNodeV1`; `sort` is an array of inlined `SortTermV1` values. No `$ref`, named type token, registry lookup, source-code enum, or prose lookup is admitted.

`TypeNodeV1` is the following closed JSON grammar:

- `{"kind":"null"}`, `{"kind":"bool"}`, `{"kind":"string"}`, `{"kind":"int"}`, `{"kind":"decimal"}`, `{"kind":"bytes32"}`, `{"kind":"date"}`, or `{"kind":"instant"}`;
- `{"kind":"enum","values":[...]}` with at least one unique string in declared rank order;
- `{"kind":"nullable","value":<TypeNodeV1>}`;
- `{"kind":"array","semantics":"sequence|set","items":<TypeNodeV1>}`; or
- `{"kind":"record","fields":[{"name":string,"value":<TypeNodeV1>},...]}` with unique fields in semantic encoding order.

`SortTermV1` is `{path:string[],collation:"utf8|raw32|int|semantic_bytes|enum_rank",direction:"asc",enumValues:string[]}`. `enumValues` is populated only for `enum_rank` and supplies the complete rank order. The reduction definition is `none`, `ordered_raw32`, or `prefix_lower_hex`; output is `raw32_and_lower_hex` or `utf8_identifier`. A reduction row's input is an inlined record containing `digest:bytes32` and every metadata field referenced by its sort terms. A bytes row's input is an inlined bytes value with its exact semantic label. An identifier row's input is `bytes32`.

For every row in this section, `domain_tag` is the exact ASCII string `jobkit-public-hash/<registry-name>/v1`, `typed_schema_name` is `<registry-name>Schema`, and `typed_schema_version=1`. The payload schema's own version remains part of its named type and fields. Record and reduction output is `raw32_and_lower_hex`; bytes output is `raw32_and_lower_hex`; identifier output is `utf8_identifier`. Record rows use `ordering_rule=declared_fields` and `reduction_rule=none`. Reduction rows use `ordering_rule` from the reduction table and `reduction_rule=ordered_raw32`. Bytes rows use `ordering_rule=exact_bytes` and `reduction_rule=none`. Identifier rows use `ordering_rule=single_raw32` and `reduction_rule=prefix_lower_hex`.

The migration generator expands every named schema and enum in the human-readable tables below into this inlined tree before producing SQL. The SQL seed contains literal canonical `schema_definition_json` and its bootstrap hash. Runtime codec generation receives one selected database row and the fixed `PublicHashDefinitionV1` meta-codec; it receives zero application schema objects. Lowercase hexadecimal remains transport only.

`HashKindV1` is `record`, `reduction`, `bytes`, or `identifier`. `RequestScopeKindV1` is `board`, `listing`, or `public_job`. `DescriptionProducerKindV1` is `codex`, `operator`, or `deterministic`. `DescriptionReviewStateV1` is `approved`, `rejected`, or `needs_review`. `DescriptionReviewerKindV1` is `operator` or `deterministic`. `LifecycleActionV1` is `close`, `reopen`, `suppress`, `clear_suppression`, `delete`, or `rollback_merge`. `TerminalStateV1` is `blocked`, `failed`, or `superseded`.

The record schemas are field-ordered as follows. A row containing one named schema means the row uses that named schema's complete declared field order.

| Registry name                          | Exact ordered fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `algorithmBundleHash`                  | `identifiers:array<string,sequence>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `requestKeyHash`                       | `ProjectionCandidateRequestV4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `legacy0049RequestHash`                | `requestKey:string`, `mode:string`, `scopeJsonHash:bytes32`, `contractVersion:int`, `projectorVersion:string`, `policyHeadsHash:bytes32`, `sourceWatermarkJsonHash:bytes32`                                                                                                                                                                                                                                                                                                                                                |
| `requestScopeMemberHash`               | `scopeKind:RequestScopeKindV1`, `scopeKey:string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `requestScopePageZeroPredecessorHash`  | `requestHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `requestScopePageHash`                 | `pageOrdinal:int`, `firstMemberOrdinal:int`, `memberCount:int`, `pageByteCount:int`, `previousPageHash:bytes32`, `orderedMemberHashes:array<bytes32,sequence>`                                                                                                                                                                                                                                                                                                                                                             |
| `componentHash`                        | `componentKind:ComponentKindV1`, `allocationState:nullable<D3AllocationStateV1>`, `allocationReasonCode:nullable<D3AllocationReasonCodeV1>`, `allocationHash:nullable<bytes32>`, `orderedRootIds:array<string,sequence>`                                                                                                                                                                                                                                                                                                   |
| `coreTemplateSlotHash`                 | `templateId:string`, `slotOrdinal:int`, `operation:string`, `targetKind:string`, `minRows:int`, `maxRows:int`, `targetKeySchemaHash:bytes32`, `postconditionSchemaHash:bytes32`, `mutationSqlHash:bytes32`, `assertionSqlHash:bytes32`                                                                                                                                                                                                                                                                                     |
| `coreMutationWitnessHash`              | `transactionId:string`, `templateId:string`, `slotOrdinal:int`, `slotHash:bytes32`, `targetKeyHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dependencyMemberHash`                 | `kind:DependencyKindV1`, `key:string`, `version:string`, `hash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dependencyPageZeroPredecessorHash`    | `requestKey:string`, `componentHash:bytes32`, `generation:int`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dependencyPageHash`                   | `pageOrdinal:int`, `firstMemberOrdinal:int`, `memberCount:int`, `pageByteCount:int`, `previousPageHash:bytes32`, `orderedMemberHashes:array<bytes32,sequence>`                                                                                                                                                                                                                                                                                                                                                             |
| `rootSetLeafHash`                      | `publicJobId:string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `applicationAuthoritySnapshotPinHash`  | `snapshotId:string`, `snapshotHash:bytes32`, `state:ApplicationAuthoritySnapshotStateV1`, `effectiveAt:instant`, `expiresAt:nullable<instant>`                                                                                                                                                                                                                                                                                                                                                                             |
| `analysisHash`                         | `sourcePositionId:string`, `version:int`, `listingMaterialVersion:int`, `listingMaterialHash:bytes32`, `positionPayloadVersion:int`, `positionPayloadHash:bytes32`, `schemaVersion:string`, `producerKind:string`, `producerId:string`, `promptVersion:string`, `modelId:string`, `sourceTextHash:bytes32`, `outputJsonHash:bytes32`                                                                                                                                                                                       |
| `matchFactHash`                        | `sourcePositionId:string`, `version:int`, `listingMaterialVersion:int`, `positionPayloadVersion:int`, `positionPayloadHash:bytes32`, `matchSchemaVersion:string`, `factsJsonHash:bytes32`                                                                                                                                                                                                                                                                                                                                  |
| `claimHash`                            | `claimKind:string`, `destinationField:nullable<CandidateFieldNameV1>`, `destinationSection:nullable<DescriptionSectionV1>`, `normalizedClaimJsonHash:bytes32`                                                                                                                                                                                                                                                                                                                                                              |
| `evidenceEntryHash`                    | `sourcePositionId:string`, `evidenceSetVersion:int`, `ordinal:int`, `claimKind:string`, `destinationField:nullable<CandidateFieldNameV1>`, `destinationSection:nullable<DescriptionSectionV1>`, `sourceStartUtf8:int`, `sourceEndUtf8:int`, `sourceExcerptHash:bytes32`, `disposition:EvidenceDispositionV1`, `normalizedClaimJsonHash:bytes32`, `claimHash:bytes32`                                                                                                                                                       |
| `evidenceHash`                         | `evidenceKind:string`, `evidenceKey:string`, `evidenceVersion:string`, `evidencePayloadHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `assertionHash`                        | `publicJobId:string`, `fieldName:CandidateFieldNameV1`, `sourcePositionId:string`, `valueSchema:string`, `valueJsonHash:bytes32`, `evidenceSetHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                |
| `fieldPolicyInputHash`                 | `sourceKey:string`, `policyVersion:int`, `policyHash:bytes32`, `labelVersion:int`, `labelHash:bytes32`, `sourceOpenVersion:int`, `sourceOpenHash:bytes32`, `listingMaterialVersion:int`, `listingMaterialHash:bytes32`, `evidenceSetVersion:int`, `evidenceSetHash:bytes32`                                                                                                                                                                                                                                                |
| `sourceOpenHash`                       | `sourcePositionId:string`, `version:int`, `predecessorVersion:nullable<int>`, `listingId:string`, `listingMaterialVersion:int`, `listingMaterialHash:bytes32`, `state:SourceOpenStateV1`, `evidenceKind:SourceOpenEvidenceKindV1`, `evidenceVersion:string`, `evidenceHash:bytes32`, `observedAt:instant`, `idempotencyKey:string`                                                                                                                                                                                         |
| `sourceOpenEvidenceHash`               | `sourcePositionId:string`, `listingId:string`, `listingMaterialVersion:int`, `listingMaterialHash:bytes32`, `inventoryStatus:string`, `observedAt:instant`                                                                                                                                                                                                                                                                                                                                                                 |
| `fieldDecisionHash`                    | `publicJobId:string`, `fieldName:CandidateFieldNameV1`, `sourcePositionId:string`, `fieldPolicyInputHash:bytes32`, `state:FieldDecisionStateV1`, `reasonCode:nullable<CoreReasonCodeV1>`, `assertionHash:bytes32`                                                                                                                                                                                                                                                                                                          |
| `sourceOriginHash`                     | `SourceOriginAssertionV1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `sourceSelectionHash`                  | `publicJobId:string`, `sourcePositionId:string`, `originRank:int`, `positionRank:int`, `priorPrimaryRank:int`, `originAssertionHash:bytes32`, `analysisHash:bytes32`, `evidenceSetHash:bytes32`, `descriptionArtifactHash:bytes32`                                                                                                                                                                                                                                                                                         |
| `sourceBindingHash`                    | `factKind:CandidateFactKindV1`, `naturalKeyHash:bytes32`, `sourcePositionId:string`, `assertionHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `fallbackEnvelopeHash`                 | `publicJobId:string`, `fieldName:FallbackFieldV1`, `envelopeJsonHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `descriptionArtifactHash`              | `sourcePositionId:string`, `version:int`, `listingMaterialVersion:int`, `positionPayloadVersion:int`, `positionPayloadHash:bytes32`, `evidenceSetVersion:int`, `evidenceSetHash:bytes32`, `fieldPolicyInputHash:bytes32`, `producerKind:DescriptionProducerKindV1`, `producerId:string`, `promptVersion:string`, `sectionsHash:bytes32`, `rendererVersion:string`, `renderedTextHash:bytes32`, `reviewState:DescriptionReviewStateV1`, `reviewerKind:DescriptionReviewerKindV1`, `reviewerId:string`, `reviewedAt:instant` |
| `verbatimCheckHash`                    | `sourcePositionId:string`, `sourceTextHash:bytes32`, `outputTextHash:bytes32`, `sourceStartCodePoint:int`, `sourceEndCodePoint:int`, `outputStartCodePoint:int`, `outputEndCodePoint:int`, `maximumSharedCodePoints:int`, `configuredLimit:int`, `passed:bool`                                                                                                                                                                                                                                                             |
| `lifecycleActionHash`                  | `publicJobId:string`, `version:int`, `predecessorVersion:nullable<int>`, `action:LifecycleActionV1`, `requestedState:RootStateV1`, `evidenceHash:bytes32`, `authorizedUserId:string`, `authorizedAt:instant`, `effectiveAt:instant`, `expiresAt:nullable<instant>`, `idempotencyKey:string`                                                                                                                                                                                                                                |
| `lifecycleRevocationHash`              | `publicJobId:string`, `actionVersion:int`, `revocationVersion:int`, `predecessorRevocationVersion:nullable<int>`, `authorizedUserId:string`, `reasonCode:CoreReasonCodeV1`, `effectiveAt:instant`, `idempotencyKey:string`                                                                                                                                                                                                                                                                                                 |
| `lifecycleCausalEventHash`             | `eventKind:LifecycleEventKindV1`, `publicJobId:string`, `actionVersion:int`, `actionHash:bytes32`, `revocationVersion:nullable<int>`, `revocationHash:nullable<bytes32>`, `effectiveAt:instant`, `expiresAt:nullable<instant>`, `predecessorHash:nullable<bytes32>`                                                                                                                                                                                                                                                        |
| `lifecycleOutboxPayloadHash`           | `eventId:string`, `eventHash:bytes32`, `topic:string`, `payloadJsonHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rootOutcomeHash`                      | `RootOutcomeV3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `candidateFactHash`                    | `CandidateFactEnvelopeV1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `candidateFactNaturalKeyHash`          | `kind:CandidateFactKindV1`, `orderedFields:array<string,sequence>`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `candidateFactPageZeroPredecessorHash` | `planHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `candidateFactPageHash`                | `pageOrdinal:int`, `firstFactOrdinal:int`, `factCount:int`, `pageByteCount:int`, `previousPageHash:bytes32`, `orderedFactHashes:array<bytes32,sequence>`                                                                                                                                                                                                                                                                                                                                                                   |
| `terminalArtifactLeafHash`             | `artifactKind:TerminalArtifactKindV1`, `artifactKey:string`, `artifactHash:bytes32`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `planHash`                             | `CandidatePlanV4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `candidateSemanticHash`                | `CandidateSemanticPayloadV4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `candidateSealHash`                    | `candidateId:string`, `candidateSemanticHash:bytes32`, `dependencyDigest:bytes32`, `rootOutcomeDigest:bytes32`, `factCount:int`, `factDigest:bytes32`, `factPageCount:int`, `factPageDigest:bytes32`                                                                                                                                                                                                                                                                                                                       |
| `candidateTerminalSealHash`            | `generation:int`, `componentKind:ComponentKindV1`, `terminalState:TerminalStateV1`, `dependencyDigest:bytes32`, `rootSetDigest:bytes32`, `primaryReasonCode:CoreReasonCodeV1`, `sortedReasonCodes:array<CoreReasonCodeV1,sequence>`, `artifactCount:int`, `artifactDigest:bytes32`                                                                                                                                                                                                                                         |
| `publicSourceDisplayLabelVersionHash`  | `sourceKey:string`, `version:int`, `predecessorVersion:nullable<int>`, `displayLabel:string`, `createdAt:instant`                                                                                                                                                                                                                                                                                                                                                                                                          |

The reduction registry is executable from these rows:

| Registry name                 | Child                      | Exact ordering                                                                     |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `requestScopeDigest`          | `requestScopeMemberHash`   | scope-kind rank `board=0`, `listing=1`, `public_job=2`, then scope-key UTF-8 bytes |
| `requestScopeExpansionDigest` | `requestScopeMemberHash`   | scope-kind rank `board=0`, `listing=1`, `public_job=2`, then scope-key UTF-8 bytes |
| `coreTemplateHash`            | `coreTemplateSlotHash`     | slot ordinal as integer                                                            |
| `dependencyDigest`            | `dependencyMemberHash`     | dependency-kind rank, key UTF-8 bytes, canonical version bytes, raw member hash    |
| `rootSetDigest`               | `rootSetLeafHash`          | public-job ID UTF-8 bytes                                                          |
| `evidenceSetHash`             | `evidenceEntryHash`        | evidence ordinal as integer                                                        |
| `fieldDecisionDigest`         | `fieldDecisionHash`        | public-job ID, field-name, source-position ID UTF-8 bytes                          |
| `sourceSelectionDigest`       | `sourceSelectionHash`      | public-job ID UTF-8 bytes                                                          |
| `sourceBindingDigest`         | `sourceBindingHash`        | fact-kind rank, natural-key semantic bytes                                         |
| `fallbackDigest`              | `fallbackEnvelopeHash`     | field rank `date_posted=0`, `valid_through=1`, `compensation=2`                    |
| `descriptionArtifactDigest`   | `descriptionArtifactHash`  | public-job ID UTF-8 bytes                                                          |
| `rootOutcomeDigest`           | `rootOutcomeHash`          | public-job ID UTF-8 bytes                                                          |
| `candidateFactDigest`         | `candidateFactHash`        | fact-kind rank, natural-key semantic bytes                                         |
| `candidateFactPageDigest`     | `candidateFactPageHash`    | page ordinal as integer                                                            |
| `terminalArtifactDigest`      | `terminalArtifactLeafHash` | artifact-kind rank, artifact-key UTF-8 bytes                                       |

The bytes schemas are the exact bytes named in the registry table; `descriptionSectionsHash` consumes canonical `DescriptionSectionsV1` JSON. Identifier construction has one input: a raw 32-byte digest.

| Identifier registry name | Input digest               | Exact prefix   |
| ------------------------ | -------------------------- | -------------- |
| `requestKey`             | `requestKeyHash`           | `prequest_v4_` |
| `componentId`            | `componentHash`            | `pcomp_v5_`    |
| `candidateId`            | `candidateSemanticHash`    | `pcand_v4_`    |
| `lifecycleCausalEventId` | `lifecycleCausalEventHash` | `plce_v1_`     |

The output is the prefix followed by lowercase hexadecimal for the 32-byte input digest.

Imported hashes belong to their upstream registries. Core validates each imported name, version, output encoding, and schema-definition hash before admitting it as a dependency member. HC-47 loads each database row in isolation, rejects any reference token or unknown node, generates its codec and ordering comparator, and verifies the row's vectors without application schema imports.

## Immutable request

The request schema is:

```ts
type AuthorityHeadRefV1 = {
  authorityKind: string;
  authorityKey: string;
  effectiveVersion: string;
  effectiveHash: string;
};

type ApplicationAuthoritySnapshotStateV1 =
  | "usable"
  | "unavailable"
  | "stale"
  | "future_effective";

type ApplicationAuthoritySnapshotRefV1 = {
  snapshotId: string;
  snapshotHash: string;
  state: ApplicationAuthoritySnapshotStateV1;
  effectiveAt: string;
  expiresAt: string | null;
};

interface ProjectionCandidateRequestV4 {
  contractVersion: 4;
  algorithmBundleHash: string;
  evaluationAt: string;
  evaluationDate: string;
  mode: "shadow";
  causalCutRef: {
    causalCutId: string;
    causalCutHash: string;
  } | null;
  scope: {
    boards: string[];
    listingIds: string[];
    publicJobIds: string[];
  };
  defaultPublicationIntent:
    | "preserve_existing"
    | "private"
    | "eligible"
    | "published";
  rootIntents: Array<{
    publicJobId: string;
    intent:
      | "preserve_existing"
      | "private"
      | "eligible"
      | "published"
      | "closed"
      | "suppressed"
      | "deleted";
    expectedPublicJobVersion: string | null;
    expectedMappingHeadDigest: string;
    expectedDecisionVersion: string | null;
    lifecycleActionVersion: string | null;
    lifecycleActionHash: string | null;
  }>;
  effectiveAuthorityHeads: AuthorityHeadRefV1[];
  applicationAuthoritySnapshotRef:
    | ApplicationAuthoritySnapshotRefV1
    | null;
}
```

Set-like arrays deduplicate and sort by encoded child bytes. `rootIntents` sorts by public job ID UTF-8 bytes and contains one row per root. The request contains current effective authority only.

### Exact request-scope algebra

The three scope arrays are selectors rather than three interchangeable bags. Request sealing normalizes each array independently by trimming its admitted strings, rejecting an empty result, deduplicating exact UTF-8 values, and sorting by UTF-8 bytes. Each empty array uses the meaning fixed below and stays independent from the other arrays.

For the source-listing branch, let `A` be the active listing cohort at the sealed source watermark, `B` be every member of `A` when `boards` is empty or the members whose exact `job_listings.board` occurs in `boards`, and `L` be every member of `A` when `listingIds` is empty or the members whose exact `job_listings.id` occurs in `listingIds`. The selected source-listing cohort is `S = B intersection L`. Consequently:

- empty `boards` plus empty `listingIds` selects every member of `A`, preserving the migration-0049 behavior;
- a nonempty board array alone selects active listings on those boards;
- a nonempty listing array alone selects those active listings; and
- nonempty board and listing arrays intersect, so a listed ID on another board stays outside `S`.

Every explicit listing ID must resolve to one `job_listings` identity while the request seals. A missing identity aborts request sealing with `request_scope_listing_missing`. An existing inactive listing satisfies identity validation and remains outside `A`; a later successor request may observe it after a new source watermark makes it active. An unknown board is an admitted selector with an empty contribution.

`publicJobIds` is an independent existing-root branch. Every explicit ID must resolve to one `public_jobs` identity while the request seals; a missing identity aborts request sealing with `request_scope_public_job_missing`. An empty array selects zero independent roots. A resolved public job remains in this branch even when it has zero active source positions.

Component discovery takes the set union of:

1. D3 allocation components reachable from source positions whose listing is in `S`; and
1. one `lifecycle_root` component for each explicit public job that is absent from every selected allocation component.

If an explicit public job already occurs as a winner, loser, or mapping predecessor in a selected allocation component, its intent joins that single component. The union deduplicates by `(componentKind,componentId)`, orders allocations by allocation ID UTF-8 bytes, then lifecycle roots by public-job ID UTF-8 bytes, and assigns contiguous component ordinals from zero. A migration-0057 blocked allocation stays a `blocked_allocation` component and follows the blocked flow below.

Request-scope members persist the normalized selectors, while the sealed source watermark and component rows persist their resolved cohort. The source-listing query is the existing board/listing intersection expressed exactly as:

```sql
SELECT listing.id
FROM job_listings AS listing
JOIN job_listing_versions AS version
  ON version.listing_id=listing.id
 AND version.material_version=listing.material_version
WHERE listing.inventory_status='active'
  AND listing.id<=:maxListingId
  AND listing.material_changed_at<=:materialChangedAt
  AND (
    :boardCount=0 OR EXISTS (
      SELECT 1 FROM json_each(:boardsJson) AS requested_board
      WHERE CAST(requested_board.value AS TEXT)=listing.board
    )
  )
  AND (
    :listingCount=0 OR EXISTS (
      SELECT 1 FROM json_each(:listingIdsJson) AS requested_listing
      WHERE CAST(requested_listing.value AS TEXT)=listing.id
    )
  )
ORDER BY listing.id COLLATE BINARY;
```

Before that query, request sealing requires both exact difference checks to return zero rows:

```sql
SELECT CAST(requested.value AS TEXT) AS missing_id
FROM json_each(:listingIdsJson) AS requested
LEFT JOIN job_listings AS listing
  ON listing.id=CAST(requested.value AS TEXT)
WHERE listing.id IS NULL
ORDER BY missing_id COLLATE BINARY;

SELECT CAST(requested.value AS TEXT) AS missing_id
FROM json_each(:publicJobIdsJson) AS requested
LEFT JOIN public_jobs AS public_job
  ON public_job.id=CAST(requested.value AS TEXT)
WHERE public_job.id IS NULL
ORDER BY missing_id COLLATE BINARY;
```

`HC-57-request-scope-algebra` covers all eight empty/nonempty selector combinations, the board/listing intersection, duplicates, an inactive explicit listing, an unknown board, a missing listing, a missing public job, a zero-source existing public job, and a public job already reached through an allocation.

```text
requestKeyHash =
  registeredRecordHash(
    "requestKeyHash",
    ProjectionCandidateRequestV4
  )

requestKey = registeredIdentifier("requestKey", requestKeyHash)
```

Requester identity, request time, run ID, delivery metadata, worker identity, and lease state live in a transport envelope outside the request hash.

### Request, scope, and run persistence

Migration `0049_public_projection_runs.sql` has a one-run-per-request `UNIQUE(request_key)` constraint. The candidate-core migration replaces that relation rather than relaxing it in place. The replacement relations are:

```text
public_projection_requests
  PK request_key
  UNIQUE request_hash
  columns:
    request_key, request_hash,
    request_contract_kind=legacy_0049|candidate_v4,
    contract_version,
    algorithm_bundle_hash, evaluation_at, evaluation_date, mode=shadow,
    canonical_payload_json, canonical_payload_byte_count,
    request_scope_digest, request_scope_member_count,
    request_scope_page_count, root_intent_count,
    effective_authority_head_count,
    application_authority_snapshot_pin_hash,
    state=building|sealed, created_at, sealed_at

public_projection_request_scope_pages
  PK (request_key,page_ordinal)
  columns:
    first_member_ordinal, member_count, canonical_page_json,
    canonical_page_byte_count, previous_page_hash, page_hash, created_at
  FK request_key -> public_projection_requests(request_key)

public_projection_request_scope_members
  PK (request_key,scope_kind,scope_key)
  UNIQUE (request_key,member_ordinal)
  columns:
    member_ordinal, page_ordinal, scope_kind=board|listing|public_job,
    scope_key, member_hash, created_at
  FK (request_key,page_ordinal)
    -> public_projection_request_scope_pages(request_key,page_ordinal)

public_projection_request_expansions
  PK (predecessor_request_key,successor_request_key)
  columns:
    added_member_count, scope_expansion_digest, created_at
  FK predecessor_request_key -> public_projection_requests(request_key)
  FK successor_request_key -> public_projection_requests(request_key)

public_projection_runs
  PK id
  UNIQUE (request_key,run_nonce)
  columns:
    id, request_key, run_nonce, requested_by_user_id, mode,
    scope_json, contract_version, projector_version,
    policy_heads_hash, source_watermark_json,
    status=queued|running|completed|completed_with_blocks|failed|canceled,
    listing_total, listing_completed, listing_blocked, listing_failed,
    listing_superseded, position_total, position_completed,
    position_blocked, position_failed, position_superseded,
    selection_cursor, selection_complete, error_code, error_detail,
    requested_at, started_at, completed_at, updated_at
  FK request_key -> public_projection_requests(request_key)
  FK requested_by_user_id -> users(id)
```

`run_nonce` is exactly 32 lowercase hexadecimal bytes generated from 16 random bytes. New run IDs are `"prun_v2_" + lowerHex(SHA256("jobkit-public-projection-run/v2" || NUL || LP(UTF8(requestKey)) || LP(rawRunNonce)))`. A request admits between one and 16 runs. A `BEFORE INSERT` trigger counts existing runs for `NEW.request_key` and raises `core_limit_request_runs` when the count is 16. The request hash excludes requester, request time, run nonce, run ID, counters, and delivery state.

Scope pages contain at most 256 members and 65,536 canonical JSON bytes. Members are globally ordered by the `requestScopeDigest` rule. Page zero uses `registeredRecordHash("requestScopePageZeroPredecessorHash", {requestHash})` as its predecessor domain separator; later pages use the prior scope-page hash. Each page hash is `registeredRecordHash("requestScopePageHash", {pageOrdinal,firstMemberOrdinal,memberCount,pageByteCount,previousPageHash,orderedMemberHashes})`. Sealing asserts page count, member count, ordinal continuity, scope digest, request hash, and request key in one counted transaction.

An expansion creates or reuses a successor request and inserts one immutable expansion edge. Its scope must be a strict superset of its predecessor's scope, preserve every predecessor root intent byte-for-byte, and add at least one scope member. `scope_expansion_digest` reduces only added `requestScopeMemberHash` values under `requestScopeExpansionDigest`. The successor receives its deterministic request key. Several predecessors may converge on the same semantic successor through distinct expansion edges. A same-scope submission reuses the existing request and may create another run.

The migration validates against the 57-file chain through `0057_public_projection_final_duplicate_graph.sql`. Migration 0044 renamed `jobs` to `job_listings`; migration 0049 created the 28-column `public_projection_runs` relation; migrations 0051, 0055, and 0057 added direct dependents. The replacement preserves the parent table name, so those foreign-key declarations and all read/update query names remain stable.

Before DDL, the migration command generates three deterministic staging relations with the runtime registry and `jobkit-canonical-json-v1`:

```text
public_projection_0049_backfill_requests
  PK legacy_run_id
  UNIQUE request_key
  columns:
    legacy_run_id, request_key, request_hash,
    canonical_payload_json, canonical_payload_byte_count,
    request_scope_digest, request_scope_member_count,
    request_scope_page_count, run_nonce

public_projection_0049_backfill_scope_pages
  PK (request_key,page_ordinal)
  columns:
    first_member_ordinal, member_count, canonical_page_json,
    canonical_page_byte_count, previous_page_hash, page_hash

public_projection_0049_backfill_scope_members
  PK (request_key,scope_kind,scope_key)
  UNIQUE (request_key,member_ordinal)
  columns: member_ordinal, page_ordinal, member_hash
```

For each legacy run, the command rejects malformed or noncanonical `scope_json` and `source_watermark_json`; computes their registered bytes hashes; computes `legacy0049RequestHash` over `request_key`, `mode`, the two JSON hashes, `contract_version`, `projector_version`, and `policy_heads_hash`; and preserves the existing request key for Worker compatibility. The nonce is the first 16 raw bytes, rendered as 32 lowercase hexadecimal characters, of `SHA256("jobkit-public-projection-run-legacy/v1" || NUL || LP(UTF8(id)))`. Scope members come from the legacy `boards` and `listingIds` arrays, use the v4 member hashes, and receive exact pages. A staging request must match exactly one migration-0049 run.

The ordered parent replacement is executable D1 migration SQL. D1 applies one migration file in its implicit transaction ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)) and keeps foreign-key enforcement enabled. The file starts with [`PRAGMA defer_foreign_keys=ON`](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) and uses a persistent guard relation because D1 migration SQL rejects explicit transaction statements and temporary tables. `PRAGMA legacy_alter_table=ON` keeps every child foreign key and child-trigger body pointed at the stable `public_projection_runs` name while the old parent is renamed. Any statement or guard failure rolls back the whole migration file.

```sql
PRAGMA defer_foreign_keys=ON;
PRAGMA legacy_alter_table=ON;

CREATE TABLE public_projection_candidate_core_migration_guards (
  guard_name TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CHECK (passed=1)
);

INSERT INTO public_projection_requests (
  request_key,request_hash,request_contract_kind,contract_version,
  algorithm_bundle_hash,evaluation_at,evaluation_date,mode,
  canonical_payload_json,canonical_payload_byte_count,
  request_scope_digest,request_scope_member_count,request_scope_page_count,
  root_intent_count,effective_authority_head_count,
  application_authority_snapshot_pin_hash,state,created_at,sealed_at
)
SELECT backfill.request_key,backfill.request_hash,'legacy_0049',run.contract_version,
       NULL,NULL,NULL,'shadow',backfill.canonical_payload_json,
       backfill.canonical_payload_byte_count,backfill.request_scope_digest,
       backfill.request_scope_member_count,backfill.request_scope_page_count,
       0,0,NULL,'sealed',run.requested_at,run.requested_at
FROM public_projection_0049_backfill_requests backfill
JOIN public_projection_runs run ON run.id=backfill.legacy_run_id;

INSERT INTO public_projection_request_scope_pages (
  request_key,page_ordinal,first_member_ordinal,member_count,
  canonical_page_json,canonical_page_byte_count,previous_page_hash,
  page_hash,created_at
)
SELECT page.request_key,page.page_ordinal,page.first_member_ordinal,
       page.member_count,page.canonical_page_json,
       page.canonical_page_byte_count,page.previous_page_hash,page.page_hash,
       run.requested_at
FROM public_projection_0049_backfill_scope_pages page
JOIN public_projection_0049_backfill_requests backfill
  ON backfill.request_key=page.request_key
JOIN public_projection_runs run ON run.id=backfill.legacy_run_id;

INSERT INTO public_projection_request_scope_members (
  request_key,scope_kind,scope_key,member_ordinal,page_ordinal,
  member_hash,created_at
)
SELECT member.request_key,member.scope_kind,member.scope_key,
       member.member_ordinal,member.page_ordinal,member.member_hash,
       run.requested_at
FROM public_projection_0049_backfill_scope_members member
JOIN public_projection_0049_backfill_requests backfill
  ON backfill.request_key=member.request_key
JOIN public_projection_runs run ON run.id=backfill.legacy_run_id;

DROP TRIGGER IF EXISTS trg_public_projection_run_limit;
DROP TRIGGER IF EXISTS trg_public_projection_run_update_guard;
ALTER TABLE public_projection_runs RENAME TO public_projection_runs_v3_old;

CREATE TABLE public_projection_runs (
  id TEXT PRIMARY KEY,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode='shadow'),
  request_key TEXT NOT NULL CHECK (trim(request_key)<>'')
    REFERENCES public_projection_requests(request_key) ON DELETE RESTRICT,
  run_nonce TEXT NOT NULL CHECK (
    length(run_nonce)=32 AND run_nonce NOT GLOB '*[^0-9a-f]*'
  ),
  scope_json TEXT NOT NULL CHECK (
    json_valid(scope_json) AND json_type(scope_json)='object'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version>0),
  projector_version TEXT NOT NULL CHECK (trim(projector_version)<>''),
  policy_heads_hash TEXT NOT NULL CHECK (length(policy_heads_hash)=64),
  source_watermark_json TEXT NOT NULL CHECK (
    json_valid(source_watermark_json)
    AND json_type(source_watermark_json)='object'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'queued','running','completed','completed_with_blocks','failed','canceled'
  )),
  listing_total INTEGER NOT NULL DEFAULT 0 CHECK (listing_total>=0),
  listing_completed INTEGER NOT NULL DEFAULT 0 CHECK (listing_completed>=0),
  listing_blocked INTEGER NOT NULL DEFAULT 0 CHECK (listing_blocked>=0),
  listing_failed INTEGER NOT NULL DEFAULT 0 CHECK (listing_failed>=0),
  listing_superseded INTEGER NOT NULL DEFAULT 0 CHECK (listing_superseded>=0),
  position_total INTEGER NOT NULL DEFAULT 0 CHECK (position_total>=0),
  position_completed INTEGER NOT NULL DEFAULT 0 CHECK (position_completed>=0),
  position_blocked INTEGER NOT NULL DEFAULT 0 CHECK (position_blocked>=0),
  position_failed INTEGER NOT NULL DEFAULT 0 CHECK (position_failed>=0),
  position_superseded INTEGER NOT NULL DEFAULT 0 CHECK (position_superseded>=0),
  selection_cursor TEXT NOT NULL DEFAULT '',
  selection_complete INTEGER NOT NULL DEFAULT 0
    CHECK (selection_complete IN (0,1)),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (request_key,run_nonce),
  UNIQUE (id,request_key),
  CHECK (
    listing_completed+listing_blocked+listing_failed+listing_superseded
      <=listing_total
  ),
  CHECK (
    position_completed+position_blocked+position_failed+position_superseded
      <=position_total
  ),
  CHECK (
    status NOT IN ('completed','completed_with_blocks','failed','canceled')
    OR completed_at IS NOT NULL
  ),
  CHECK (status<>'running' OR started_at IS NOT NULL)
);

INSERT INTO public_projection_runs (
  id,requested_by_user_id,mode,request_key,run_nonce,scope_json,
  contract_version,projector_version,policy_heads_hash,
  source_watermark_json,status,listing_total,listing_completed,
  listing_blocked,listing_failed,listing_superseded,position_total,
  position_completed,position_blocked,position_failed,position_superseded,
  selection_cursor,selection_complete,error_code,error_detail,requested_at,
  started_at,completed_at,updated_at
)
SELECT run.id,run.requested_by_user_id,run.mode,run.request_key,
       backfill.run_nonce,run.scope_json,run.contract_version,
       run.projector_version,run.policy_heads_hash,
       run.source_watermark_json,run.status,run.listing_total,
       run.listing_completed,run.listing_blocked,run.listing_failed,
       run.listing_superseded,run.position_total,run.position_completed,
       run.position_blocked,run.position_failed,run.position_superseded,
       run.selection_cursor,run.selection_complete,run.error_code,
       run.error_detail,run.requested_at,run.started_at,run.completed_at,
       run.updated_at
FROM public_projection_runs_v3_old run
JOIN public_projection_0049_backfill_requests backfill
  ON backfill.legacy_run_id=run.id AND backfill.request_key=run.request_key;

INSERT INTO public_projection_candidate_core_migration_guards(
  guard_name,passed
)
SELECT 'run_rebuild_equivalence',CASE WHEN
  (SELECT COUNT(*) FROM public_projection_runs_v3_old)=
    (SELECT COUNT(*) FROM public_projection_runs)
  AND NOT EXISTS (
    SELECT id,requested_by_user_id,mode,request_key,scope_json,
           contract_version,projector_version,policy_heads_hash,
           source_watermark_json,status,listing_total,listing_completed,
           listing_blocked,listing_failed,listing_superseded,position_total,
           position_completed,position_blocked,position_failed,
           position_superseded,selection_cursor,selection_complete,error_code,
           error_detail,requested_at,started_at,completed_at,updated_at
    FROM public_projection_runs_v3_old
    EXCEPT
    SELECT id,requested_by_user_id,mode,request_key,scope_json,
           contract_version,projector_version,policy_heads_hash,
           source_watermark_json,status,listing_total,listing_completed,
           listing_blocked,listing_failed,listing_superseded,position_total,
           position_completed,position_blocked,position_failed,
           position_superseded,selection_cursor,selection_complete,error_code,
           error_detail,requested_at,started_at,completed_at,updated_at
    FROM public_projection_runs
  )
  AND NOT EXISTS (
    SELECT id,requested_by_user_id,mode,request_key,scope_json,
           contract_version,projector_version,policy_heads_hash,
           source_watermark_json,status,listing_total,listing_completed,
           listing_blocked,listing_failed,listing_superseded,position_total,
           position_completed,position_blocked,position_failed,
           position_superseded,selection_cursor,selection_complete,error_code,
           error_detail,requested_at,started_at,completed_at,updated_at
    FROM public_projection_runs
    EXCEPT
    SELECT id,requested_by_user_id,mode,request_key,scope_json,
           contract_version,projector_version,policy_heads_hash,
           source_watermark_json,status,listing_total,listing_completed,
           listing_blocked,listing_failed,listing_superseded,position_total,
           position_completed,position_blocked,position_failed,
           position_superseded,selection_cursor,selection_complete,error_code,
           error_detail,requested_at,started_at,completed_at,updated_at
    FROM public_projection_runs_v3_old
  )
  AND NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    LEFT JOIN public_projection_requests request
      ON request.request_key=run.request_key
    WHERE request.request_key IS NULL
  )
THEN 1 ELSE 0 END;

DROP TABLE public_projection_runs_v3_old;

CREATE INDEX idx_public_projection_runs_status
  ON public_projection_runs(status,requested_at);
CREATE INDEX idx_public_projection_runs_request
  ON public_projection_runs(request_key,requested_at,id);

CREATE TRIGGER trg_public_projection_run_limit
BEFORE INSERT ON public_projection_runs
WHEN (SELECT COUNT(*) FROM public_projection_runs
      WHERE request_key=NEW.request_key)>=16
BEGIN
  SELECT RAISE(ABORT,'core_limit_request_runs');
END;

CREATE TRIGGER trg_public_projection_run_update_guard
BEFORE UPDATE ON public_projection_runs
BEGIN
  SELECT CASE WHEN OLD.status IN (
    'completed','completed_with_blocks','failed','canceled'
  ) AND (
    NEW.status IS NOT OLD.status
    OR NEW.listing_total IS NOT OLD.listing_total
    OR NEW.listing_completed IS NOT OLD.listing_completed
    OR NEW.listing_blocked IS NOT OLD.listing_blocked
    OR NEW.listing_failed IS NOT OLD.listing_failed
    OR NEW.listing_superseded IS NOT OLD.listing_superseded
    OR NEW.position_total IS NOT OLD.position_total
    OR NEW.position_completed IS NOT OLD.position_completed
    OR NEW.position_blocked IS NOT OLD.position_blocked
    OR NEW.position_failed IS NOT OLD.position_failed
    OR NEW.position_superseded IS NOT OLD.position_superseded
    OR NEW.selection_cursor IS NOT OLD.selection_cursor
    OR NEW.selection_complete IS NOT OLD.selection_complete
    OR NEW.error_code IS NOT OLD.error_code
    OR NEW.error_detail IS NOT OLD.error_detail
    OR NEW.started_at IS NOT OLD.started_at
    OR NEW.completed_at IS NOT OLD.completed_at
    OR NEW.updated_at IS NOT OLD.updated_at
  ) THEN RAISE(ABORT,'terminal projection run is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
    OR NEW.mode IS NOT OLD.mode
    OR NEW.request_key IS NOT OLD.request_key
    OR NEW.run_nonce IS NOT OLD.run_nonce
    OR NEW.scope_json IS NOT OLD.scope_json
    OR NEW.contract_version IS NOT OLD.contract_version
    OR NEW.projector_version IS NOT OLD.projector_version
    OR NEW.policy_heads_hash IS NOT OLD.policy_heads_hash
    OR NEW.source_watermark_json IS NOT OLD.source_watermark_json
    OR NEW.requested_at IS NOT OLD.requested_at
  THEN RAISE(ABORT,'projection run request snapshot is immutable') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
    OR (OLD.status='running' AND NEW.status IN (
      'completed','completed_with_blocks','failed','canceled'
    ))
  ) THEN RAISE(ABORT,'invalid projection run status transition') END;

  SELECT CASE WHEN
    NEW.listing_total<OLD.listing_total
    OR NEW.listing_completed<OLD.listing_completed
    OR NEW.listing_blocked<OLD.listing_blocked
    OR NEW.listing_failed<OLD.listing_failed
    OR NEW.listing_superseded<OLD.listing_superseded
    OR NEW.position_total<OLD.position_total
    OR NEW.position_completed<OLD.position_completed
    OR NEW.position_blocked<OLD.position_blocked
    OR NEW.position_failed<OLD.position_failed
    OR NEW.position_superseded<OLD.position_superseded
    OR NEW.selection_complete<OLD.selection_complete
  THEN RAISE(ABORT,'projection run progress cannot move backward') END;
END;

INSERT INTO public_projection_candidate_core_migration_guards(
  guard_name,passed
)
SELECT 'foreign_key_check',CASE WHEN NOT EXISTS (
  SELECT 1 FROM pragma_foreign_key_check
) THEN 1 ELSE 0 END;

PRAGMA defer_foreign_keys=OFF;
PRAGMA legacy_alter_table=OFF;
```

After Wrangler reports the migration applied, the D1 verification command requires `PRAGMA foreign_keys=1`, `PRAGMA defer_foreign_keys=0`, `PRAGMA legacy_alter_table=0`, two passing guard rows, zero rows from `PRAGMA foreign_key_check`, and the original run count. D1's query authorizer exposes the first three pragmas; the separate SQLite parity harness supplies `PRAGMA integrity_check='ok'`. The three staging relations and guard relation remain persistent audit evidence until a later cleanup migration follows hostile-suite acceptance. D1 rollback restores the original parent name and contents when any migration statement fails.

Worker query impact is exact. `worker/services/public-projection/runs.ts:runColumns` and every run-state update continue unchanged because all 28 migration-0049 columns retain their names and types. `createPublicProjectionRun` changes its insert path: it seals or reuses `public_projection_requests`, generates a nonce and `prun_v2_` ID, inserts `run_nonce`, and reads the new row by `(request_key,run_nonce)`. Its former `INSERT OR IGNORE` and `WHERE request_key=? LIMIT 1` behavior is retired. A `legacy_0049` request is readable by the existing summary route and fails candidate claim admission with `legacy_request_requires_v4_successor`.

Request, page, member, and expansion rows reject updates and deletes after request sealing. Run state may advance through its declared state machine while the run's `request_key` and `run_nonce` remain immutable.

## Components and dependency closure

An admitted allocation component contains one D3 winner, zero or more D3 losers, and all mapping predecessors touched by that allocation graph. Each independent lifecycle root forms its own `lifecycle_root` component. A D3 allocation that migration 0057 sealed as blocked forms a terminal-only `blocked_allocation` component. Component roots freeze before source selection.

`D3AllocationStateV1` is `promotable` or `blocked`. `D3AllocationReasonCodeV1` is the exact migration-0057 set `new_public_entity`, `existing_source_mapping`, `existing_duplicate_winner`, `public_identity_ambiguous`, `public_job_id_collision`, or `promotion_component_too_large`. `ComponentKindV1` is `allocation=0`, `lifecycle_root=1`, or `blocked_allocation=2`.

```text
orderedRootIds = unique public job IDs sorted by UTF-8 bytes

componentHash = registeredRecordHash(
  "componentHash",
  {
    componentKind,
    allocationState,
    allocationReasonCode,
    allocationHash,
    orderedRootIds
  }
)

componentId = registeredIdentifier("componentId", componentHash)
```

`allocationHash`, `allocationState`, and `allocationReasonCode` are required for both allocation kinds and null for `lifecycle_root`. `lifecycle_root` contains exactly one root. A promotable allocation contains between one and 25 roots. A blocked allocation has an empty `orderedRootIds` array and zero component-root rows; its migration-0057 allocation artifact and final seal carry the complete blocked graph without importing an oversized or ambiguous root set into candidate semantics. The immutable storage relations are:

```text
public_projection_candidate_components
  PK (run_id,component_id)
  UNIQUE (run_id,component_ordinal)
  UNIQUE (run_id,component_id,component_kind)
  columns:
    component_ordinal, component_kind, allocation_state,
    allocation_reason_code, allocation_hash,
    component_hash, root_count, root_set_digest,
    canonical_component_json, canonical_component_byte_count, created_at
  FK run_id -> public_projection_runs(id)

public_projection_candidate_component_roots
  PK (run_id,component_id,public_job_id)
  UNIQUE (run_id,component_id,root_ordinal)
  columns: root_ordinal, root_role=winner|loser|lifecycle, created_at
  FK (run_id,component_id)
    -> public_projection_candidate_components(run_id,component_id)
```

The same semantic component may reuse `component_id` in several runs. The `run_id` prefix keeps operational rows independent. Sealing a component asserts ordered roots, count, `root_set_digest`, `component_hash`, `component_id`, and the 262,144-byte component ceiling. Sealed component and root rows reject update and delete.

A `blocked_allocation` admits only after selecting the exact immutable `public_projection_allocation_components(run_id,id)` row and matching `public_projection_final_duplicate_seals(run_id)` row from migration 0057. It seals both dependencies, creates one candidate item with `component_kind='blocked_allocation'`, claims generation one, and writes a blocked terminal seal carrying the same component kind. It writes zero plan, field-decision, fact, candidate, success-seal, or accepted-binding rows. Core maps reasons exactly: `public_identity_ambiguous` to `d3_allocation_public_identity_ambiguous`, `public_job_id_collision` to `d3_allocation_public_job_id_collision`, and `promotion_component_too_large` to `d3_allocation_component_too_large`. A blocked row carrying any promotable reason, or a promotable row carrying any blocked reason, fails with `d3_allocation_state_reason_mismatch`.

The blocked terminal uses the registered empty `rootSetDigest`, empty `terminalArtifactDigest`, and the two migration-0057 dependency members. Its item transition is `queued -> processing -> blocked`. Its generation transition is `processing -> blocked`. The final run-accounting vector is `total=1`, `queued=0`, `processing=0`, `retryable=0`, `sealed=0`, `blocked=1`, `failed=0`, and `superseded=0` for a one-component run.

`public-projection-dependency-closure-v3` walks these current immutable inputs:

1. D3 allocation graph, identity evidence, canonical organization resolution, canonical location resolution, and every decisive evidence source;
1. current source-position mappings, listing material, position payloads, source-open versions, content analyses, match facts, evidence sets, origin assertions, and authored-description heads;
1. current effective source policy, source label, source-policy URL evidence, field allowlist, and verbatim limits;
1. current public predecessor content, mapping, and eligibility heads for every affected root;
1. current lifecycle action and revocation heads;
1. the opaque application-authority snapshot reference; and
1. every resolution and evidence row needed to explain the candidate.

Every dependency member has the exact shape `{kind,key,version,hash}`. `kind` is one `DependencyKindV1` value from the following closed manifest. `key` is the listed immutable row key encoded by joining components with ASCII unit separator `U+001F`; source values containing that scalar fail admission. `version` is the immutable version or snapshot ID. `hash` uses the listed registered hash.

Kinds backed by SQLite integer versions encode `version` as a canonical positive integer string. Snapshot-ID and imported text-version kinds preserve the exact validated UTF-8 ID. The kind manifest enforces one lexical form within each kind.

| Rank | Dependency kind                     | Exact key                                        | Exact version                           | Exact hash                            |
| ---: | ----------------------------------- | ------------------------------------------------ | --------------------------------------- | ------------------------------------- |
|    0 | `d3_final_seal`                     | run ID                                           | finalization + allocation algorithm IDs | migration-0057 `seal_hash`            |
|    1 | `d3_allocation`                     | run ID + allocation ID                           | finalization + allocation algorithm IDs | migration-0057 `artifact_hash`        |
|    2 | `d3_resolution_seal`                | run ID + position-item ID                        | literal `migration-0055`                | migration-0055 `seal_hash`            |
|    3 | `canonical_organization_resolution` | run ID + organization-resolution ID              | migration-0055 `resolver_version`       | migration-0055 `resolution_hash`      |
|    4 | `canonical_location_resolution`     | run ID + location-resolution ID                  | migration-0055 `resolver_version`       | migration-0055 `resolution_hash`      |
|    5 | `d3_decisive_evidence`              | evidence kind + run ID + resolution ID + ordinal | literal `migration-0055`                | migration-0055 `evidence_hash`        |
|    6 | `source_position_mapping`           | source position ID                               | mapping version                         | migration-0048 `mapping_hash`         |
|    7 | `listing_material`                  | listing ID                                       | material version                        | migration-0047 `material_hash`        |
|    8 | `source_position_payload`           | source position ID                               | payload version                         | `positionPayloadHash`                 |
|    9 | `source_open_snapshot`              | source position ID                               | source-open version                     | `sourceOpenHash`                      |
|   10 | `position_content_analysis`         | source position ID                               | analysis version                        | `analysisHash`                        |
|   11 | `position_match_facts`              | source position ID                               | match-fact version                      | `matchFactHash`                       |
|   12 | `position_evidence_set`             | source position ID                               | evidence-set version                    | `evidenceSetHash`                     |
|   13 | `source_origin_assertion`           | source position ID                               | origin-assertion version                | `sourceOriginHash`                    |
|   14 | `authored_description`              | source position ID                               | description version                     | `descriptionArtifactHash`             |
|   15 | `source_publication_policy`         | source key                                       | migration-0048 policy version           | migration-0048 `policy_hash`          |
|   16 | `public_source_display_label`       | source key                                       | migration-0053 label version            | `publicSourceDisplayLabelVersionHash` |
|   17 | `public_predecessor_content`        | public job ID                                    | migration-0048 public-job version       | migration-0048 `public_content_hash`  |
|   18 | `public_predecessor_eligibility`    | public job ID                                    | migration-0048 decision version         | migration-0048 `decision_hash`        |
|   19 | `lifecycle_action`                  | public job ID                                    | action version                          | `lifecycleActionHash`                 |
|   20 | `lifecycle_revocation`              | public job ID + canonical action-version integer | revocation version                      | `lifecycleRevocationHash`             |
|   21 | `application_authority_snapshot`    | snapshot ID                                      | snapshot ID                             | snapshot hash                         |

The physical source map is normative:

| Kind                                | Exact immutable source relation and key                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d3_final_seal`                     | `public_projection_final_duplicate_seals(run_id)` from 0057                                                                                                                                      |
| `d3_allocation`                     | `public_projection_allocation_components(run_id,id)` from 0057; its immutability trigger is required                                                                                             |
| `d3_resolution_seal`                | `public_projection_resolution_seals(run_id,position_item_id)` from 0055                                                                                                                          |
| `canonical_organization_resolution` | `public_projection_organization_resolutions(id)` with matching `run_id` from 0055                                                                                                                |
| `canonical_location_resolution`     | `public_projection_location_resolutions(id)` with matching `run_id` from 0055                                                                                                                    |
| `d3_decisive_evidence`              | `public_projection_organization_evidence(resolution_id,ordinal)` or `public_projection_location_evidence(resolution_id,ordinal)` from 0055; evidence kind prefix is `organization` or `location` |
| `source_position_mapping`           | `job_source_position_mapping_versions(source_position_id,version)` from 0048                                                                                                                     |
| `listing_material`                  | `job_listing_versions(listing_id,material_version)` from 0047                                                                                                                                    |
| `source_position_payload`           | `job_source_position_payload_versions(source_position_id,version)` owned by source-position version authority                                                                                    |
| `source_open_snapshot`              | `job_source_position_open_versions(source_position_id,version)` owned by source-position version authority                                                                                       |
| `position_content_analysis`         | `job_source_position_content_analysis_versions(source_position_id,version)` owned by source-position version authority                                                                           |
| `position_match_facts`              | `job_source_position_match_fact_versions(source_position_id,version)` owned by source-position version authority                                                                                 |
| `position_evidence_set`             | `job_source_position_evidence_set_versions(source_position_id,version)` and its exact entry rows owned by source-position version authority                                                      |
| `source_origin_assertion`           | `job_source_position_origin_versions(source_position_id,version)` owned by source-position version authority                                                                                     |
| `authored_description`              | `job_source_position_authored_description_versions(source_position_id,version)` owned by source-position version authority                                                                       |
| `source_publication_policy`         | `source_publication_policy_versions(source_key,version)` from 0048                                                                                                                               |
| `public_source_display_label`       | `public_source_display_label_versions(source_key,version)` from 0053 after the hash backfill below                                                                                               |
| `public_predecessor_content`        | `public_job_versions(public_job_id,version)` from 0048                                                                                                                                           |
| `public_predecessor_eligibility`    | `public_job_eligibility_decisions(public_job_id,decision_version)` from 0048                                                                                                                     |
| `lifecycle_action`                  | `public_job_lifecycle_action_versions(public_job_id,version)` introduced by core                                                                                                                 |
| `lifecycle_revocation`              | `public_job_lifecycle_action_revocations(public_job_id,action_version,revocation_version)` introduced by core                                                                                    |
| `application_authority_snapshot`    | Opaque immutable snapshot relation owned by the application-authority contract and admitted by exact ID/hash                                                                                     |

The two algorithm-ID versions join their strings with U+001F. Every other composite key follows the manifest's U+001F rule. Version relations use consecutive positive integer versions, predecessor foreign keys, unique idempotency keys, and immutable update/delete triggers. Each mutable head selects one immutable version. Head deletion is prohibited; the owning writer may insert version one or advance a head through the exact predecessor-version/hash CAS, while the database authorizer rejects every other update. A core request accepts only current head versions at request sealing. The 0055 and 0057 rows already form run-scoped immutable snapshots and use their existing versions directly.

Members sort by the rank above, key UTF-8 bytes, canonical version bytes, and raw hash. Every kind references an immutable version. A mutable head may select the version during request sealing; candidate preparation reads the selected version directly.

Migration 0053 stores display-label versions without hashes. The candidate-core migration adds `display_label_hash` and backfills it with `publicSourceDisplayLabelVersionHash` over `source_key`, `version`, `predecessor_version`, `display_label`, and `created_at` in that exact order. Insert triggers compute or validate the hash. The migration asserts every row's hash and adds immutable update/delete triggers. Effective label selection joins `source_publication_policy_label_versions` to the exact label version and requires that version to equal `public_source_display_label_heads.current_version` at request sealing. The request pins label version, label hash, and label head. A head advance before candidate acceptance produces dependency drift. An advance after candidate sealing leaves the immutable candidate intact and makes downstream promotion revalidate the newer head.

Core reads source openness from immutable versions:

`SourceOpenStateV1` is `open`, `closed`, or `unknown`. `SourceOpenEvidenceKindV1` is `source_assertion`, `board_assertion`, or `legacy_inventory_snapshot`.

```text
job_source_position_open_versions
  PK (source_position_id,version)
  UNIQUE (source_position_id,idempotency_key)
  columns:
    predecessor_version, listing_id, listing_material_version,
    listing_material_hash,
    state=open|closed|unknown,
    evidence_kind=source_assertion|board_assertion|legacy_inventory_snapshot,
    evidence_version, evidence_hash, source_open_hash,
    observed_at, idempotency_key, created_at

job_source_position_open_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_open_versions(source_position_id,version)
```

The executable source-open DDL references the post-0044 names and current keys:

```sql
CREATE TABLE job_source_position_open_versions (
  source_position_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version>0),
  predecessor_version INTEGER,
  listing_id TEXT NOT NULL,
  listing_material_version INTEGER NOT NULL CHECK (listing_material_version>0),
  listing_material_hash TEXT NOT NULL CHECK (length(listing_material_hash)=64),
  state TEXT NOT NULL CHECK (state IN ('open','closed','unknown')),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN (
    'source_assertion','board_assertion','legacy_inventory_snapshot'
  )),
  evidence_version TEXT NOT NULL CHECK (trim(evidence_version)<>''),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  source_open_hash TEXT NOT NULL CHECK (length(source_open_hash)=64),
  observed_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (trim(idempotency_key)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_position_id,version),
  UNIQUE (source_position_id,idempotency_key),
  FOREIGN KEY (source_position_id,predecessor_version)
    REFERENCES job_source_position_open_versions(source_position_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_position_id,listing_id)
    REFERENCES job_source_positions(id,listing_id) ON DELETE RESTRICT,
  FOREIGN KEY (listing_id,listing_material_version)
    REFERENCES job_listing_versions(listing_id,material_version)
    ON DELETE RESTRICT,
  CHECK (
    (version=1 AND predecessor_version IS NULL)
    OR (version>1 AND predecessor_version=version-1)
  )
);

CREATE TABLE job_source_position_open_heads (
  source_position_id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version>0),
  current_hash TEXT NOT NULL CHECK (length(current_hash)=64),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_position_id,current_version)
    REFERENCES job_source_position_open_versions(source_position_id,version)
    ON DELETE RESTRICT
);
```

The backfill command executes this exact current-chain query and computes registered hashes outside SQLite:

```sql
SELECT position.id AS source_position_id,
       position.listing_id,
       listing.material_version,
       version.material_hash,
       listing.inventory_status,
       CASE WHEN trim(listing.material_changed_at)<>''
            THEN listing.material_changed_at ELSE listing.updated_at END
         AS observed_at
FROM job_source_positions position
JOIN job_listings listing ON listing.id=position.listing_id
JOIN job_listing_versions version
  ON version.listing_id=listing.id
 AND version.material_version=listing.material_version
ORDER BY position.id;
```

For every row, `active` maps to `open` and `closed` maps to `closed`; the migration-0035 check admits exactly those two inventory statuses. Version is one, predecessor is null, evidence kind is `legacy_inventory_snapshot`, evidence version is `"legacy-inventory:" + canonical material version`, and idempotency key is `"legacy-open-v1:" + listingId + ":" + canonical material version + ":" + inventoryStatus`. `sourceOpenEvidenceHash` hashes the selected fields. `sourceOpenHash` then hashes the complete version row declared in the registry. The loader writes a staging row containing both hashes.

One transaction inserts all version-one rows from staging, inserts one head per position, and inserts exact-one count guards for: selected positions, staged rows, version rows, head rows, missing listing-material foreign keys, evidence-hash mismatches, source-open-hash mismatches, and duplicate heads. Update/delete triggers make version rows immutable. A head-advance trigger requires `NEW.current_version=OLD.current_version+1`, `NEW.current_hash` to match that successor row, and the successor predecessor to equal the old version.

Every later inventory observation appends a successor and advances the head in one counted transaction. The inventory observer may read `job_listings.inventory_status`; candidate request sealing and candidate generation read only the pinned open-version row and head. HC-35 verifies the exact current table name, version-one row counts, pre-acceptance head drift, and post-seal immutability.

Dependency closure storage is:

```text
public_projection_candidate_dependency_pages
  PK (run_id,component_id,generation,page_ordinal)
  columns:
    first_member_ordinal, member_count, canonical_page_json,
    canonical_page_byte_count, previous_page_hash, page_hash,
    state=writing|sealed, created_at, sealed_at

public_projection_candidate_dependencies
  PK (run_id,component_id,generation,dependency_kind,dependency_key)
  UNIQUE (run_id,component_id,generation,member_ordinal)
  columns:
    member_ordinal, page_ordinal, dependency_version,
    dependency_hash, member_hash, created_at
```

Pages contain at most 256 members and each member, page, and closure obeys the core byte ceilings. Page zero uses `registeredRecordHash("dependencyPageZeroPredecessorHash", {requestKey,componentHash,generation})`; each later page uses the prior sealed `dependencyPageHash`. Each page hash is `registeredRecordHash("dependencyPageHash", {pageOrdinal,firstMemberOrdinal,memberCount,pageByteCount,previousPageHash,orderedMemberHashes})`. Page rows foreign-key to the generation, and member rows foreign-key to their page. Sealed pages and members reject update/delete. Preparation reads each pinned immutable row twice. Between reads it also reads the corresponding mutable head. A changed head or version hash supersedes the generation with `dependency_head_drift`; a missing version blocks with `dependency_snapshot_missing`; a mismatched version hash fails with `dependency_hash_mismatch`.

The acceptance transaction reasserts every corresponding head version and hash before its first write. A head advance through that assertion supersedes the generation. An advance after accepted sealing preserves the immutable candidate; a later request observes the successor head.

The closure excludes live catalog heads, catalog fragments, pending publication targets, source-global activation plans, emergency plans, scheduled-event state, route internals, contact internals, application attempts, and promotion limits.

Candidate preparation reads the closure twice in the same worker evaluation and seals only matching digests. D1 transactions provide atomic writes rather than a cross-request read snapshot, so the second read plus the acceptance-transaction head assertion form the drift fence. Promotion performs its own downstream revalidation.

## Position-scoped analyses and evidence

`public-source-position-version-authority-v1` creates and advances immutable position-scoped versions before a candidate-v4 request seals. Candidate request sealing and generation consume selected versions and heads. Candidate-worker has read authority over these relations and write authority over none of them.

The version-authority surface has four explicit writer classes:

| Writer class         | Entry point                               | Exact purpose                                                                                                                               |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| migration backfill   | `source-position-version-backfill-v1`     | Create deterministic version-one payload, open-state, analysis, match, evidence, origin, and description rows from admitted legacy material |
| inventory observer   | `source-position-open-observer-v1`        | Append one source-open observation and advance its head                                                                                     |
| payload materializer | `source-position-payload-materializer-v1` | Append one validated position payload and advance its head                                                                                  |
| derived producer     | `source-position-derived-producer-v1`     | Append one analysis, match, evidence set, origin assertion, or authored description and advance its matching head                           |

Each entry point uses its own closed counted-transaction template and database-authorizer allowlist. The migration backfill writer may write only the version/head relations listed in this section plus its persistent staging and migration-guard relations. The inventory observer may write only source-open versions and heads. The payload materializer may write only payload versions and heads. A derived producer may write only the one declared derived version family, that family's child rows, and its head. Every writer may also write counted transaction context, assertion, receipt, and operation-witness columns. The authorizer rejects writes to candidate, live public, catalog, route, contact, destination, and application-attempt relations.

Candidate-worker's allowlist contains `public_projection_requests`, request scope and expansion rows, candidate components and roots, candidate run accounting, items, generations, dependencies, decisions, plans, facts, pages, candidates, bindings, and seals. Every `job_source_position_*` version or head relation belongs to source-position version authority. A missing required head yields `dependency_snapshot_missing`; producer completion precedes candidate generation.

The sealed request pins every selected source-position head version and hash. Version-authority work therefore finishes before request sealing. A later head advance causes the declared drift outcome and a successor request can observe the new version.

The immutable position-scoped relations are:

```text
job_source_position_payload_versions
  PK (source_position_id, version)
  UNIQUE (source_position_id, idempotency_key)
  columns:
    source_position_id, version, predecessor_version,
    listing_id, listing_material_version, listing_material_hash,
    source_projection_run_id, source_projection_position_item_id,
    position_input_hash, payload_json, payload_hash,
    idempotency_key, created_at
  FK (source_position_id,listing_id)
    -> job_source_positions(id,listing_id)
  FK (listing_id,listing_material_version)
    -> job_listing_versions(listing_id,material_version)
  FK (source_projection_position_item_id,source_projection_run_id)
    -> public_projection_position_items(id,run_id)

job_source_position_payload_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_payload_versions(source_position_id,version)

job_source_position_content_analysis_versions
  PK (source_position_id, version)
  columns:
    source_position_id, version, predecessor_version,
    listing_material_version, listing_material_hash,
    position_payload_version, position_payload_hash, schema_version,
    producer_kind, producer_id, prompt_version, model_id,
    source_text_hash, output_json, analysis_hash,
    idempotency_key, created_at

job_source_position_content_analysis_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_content_analysis_versions(source_position_id,version)

job_source_position_match_fact_versions
  PK (source_position_id, version)
  columns:
    source_position_id, version, predecessor_version,
    listing_material_version, position_payload_version, position_payload_hash,
    match_schema_version, facts_json, match_fact_hash,
    idempotency_key, created_at

job_source_position_match_fact_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_match_fact_versions(source_position_id,version)

job_source_position_evidence_set_versions
  PK (source_position_id, version)
  columns:
    source_position_id, version, predecessor_version,
    listing_material_version, position_payload_version, position_payload_hash,
    state=building|sealed, entry_count, evidence_set_hash,
    idempotency_key, created_at

job_source_position_evidence_set_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_evidence_set_versions(source_position_id,version)

job_source_position_evidence_entries
  PK (source_position_id, evidence_set_version, ordinal)
  columns:
    claim_kind, destination_field, destination_section,
    source_start_utf8, source_end_utf8, source_excerpt_hash,
    disposition,
    normalized_claim_json, normalized_claim_json_hash,
    claim_hash, evidence_entry_hash, created_at
  FK (source_position_id,evidence_set_version)
    -> job_source_position_evidence_set_versions(source_position_id,version)
```

Every immutable version or child row above carries the `created_core_*` operation-witness columns. Every mutable head carries the `last_core_*` operation-witness columns. Those operational fields stay outside semantic hashes and are validated by the owning counted template.

The payload row stores the exact `jobkit-canonical-json-v1` source-position payload previously reconstructed from migration-0024 `job_position_analyses` and ordered `job_position_variants`. The transition loader validates it against the position schema, verifies `position_input_hash` against the immutable migration-0049 position item, and hashes the JSON bytes with `positionPayloadHash`. The payload materializer appends a successor through `source-position-payload-materializer-v1`; candidate generation reads the pinned version.

All three derived version tables carry predecessor foreign keys, a foreign key to the exact listing-material version, and a foreign key to the exact payload version. The transition loader admits a current migration-0045 `job_content_analyses` row, migration-0007 `job_match_facts` row, or migration-0024 position-analysis plus variant set only when its schema version and source hash match the pinned listing material. It writes canonical output JSON and the registered hash into version one, then advances the matching head. Missing, stale, or invalid mutable legacy analysis leaves the head absent and yields `dependency_snapshot_missing`; the normal analysis producer appends a valid version before a v4 request can seal.

`EvidenceDispositionV1` accepts exactly `selected_position`, `shared_all_positions`, `sibling_position`, `private_contact`, `source_noise`, `unsupported`, `conflicting`, `represented_elsewhere`, and `allowed_omission`. `claimHash` covers the normalized claim. `evidenceEntryHash` covers the complete entry, including its ordinal, offsets, disposition, normalized-claim JSON hash, and claim hash. The set hash is exactly:

```text
orderedEntryHashes = entries sorted by integer ordinal
assert ordinals are exactly 0 through entry_count-1
evidenceSetHash = registeredReductionHash(
  "evidenceSetHash",
  orderedEntryHashes
)
```

The evidence-set derived-producer transaction inserts the version header in `building`, inserts entries, checks one stored `evidence_entry_hash` per ordinal by recomputation, reduces those stored hashes, updates the header to `sealed` with the exact count and digest, advances the head by CAS, and records exact-one assertions for every step. The evidence-set version schema adds `state=building|sealed`; only sealed versions can become heads. Version and entry rows become immutable when sealed; head rows advance through the CAS protocol below. Each extracted position receives independent analysis, match facts, evidence, and description. A single-position listing may share a deterministic listing analysis only when the position pins the exact material, payload, and evidence hashes.

## Policy-independent identity and current-policy gating

D3 resolves organization and location from the complete evidence set before publication policy is applied. Candidate core consumes that sealed identity and its decisive evidence bindings directly.

`CandidateFieldNameV1` is the closed set `title`, `organization_name`, `locations`, `workplace_type`, `employment_types`, `role_facts`, `date_posted`, `valid_through`, `compensation`, `description`, `source_name`, and `source_url`. `FieldDecisionStateV1` is `allowed`, `withheld`, `blocked`, or `conflict`. `FallbackFieldV1` is `date_posted`, `valid_through`, or `compensation`.

`public-field-policy-selection-v1` evaluates each proposed public assertion against the request's current effective policy and label heads. The result is:

```text
public_projection_candidate_field_decisions
  PK (
    run_id, component_id, generation,
    public_job_id, field_name, source_position_id
  )
  columns:
    effective_policy_version, effective_policy_hash,
    effective_label_version, effective_label_hash,
    state=allowed|withheld|blocked|conflict,
    reason_code, assertion_hash, decision_hash
  FK (run_id,component_id,generation)
    -> public_projection_candidate_generations(run_id,component_id,generation)
```

Allowed assertions enter source selection, fallback agreement, description selection, attribution, and typed facts. Other assertions remain in the private decision ledger. A withheld or blocked decisive D3 evidence source yields a private root with `decisive_identity_evidence_withheld`. Conflicting decisive evidence yields `decisive_identity_evidence_conflict`.

Field decisions seal before plan construction. Their generation-scoped digest is an input to `CandidatePlanV4`; decision rows therefore carry generation and omit `plan_hash`. Sealed decision rows reject update/delete.

Publication readiness requires allowed title, organization, applicable location, description artifact, and a usable application-authority snapshot. Missing or stale application authority yields private state with one of:

- `application_authority_snapshot_absent`;
- `application_authority_snapshot_future_effective`;
- `application_authority_snapshot_unavailable`;
- `application_authority_snapshot_stale`; or
- `application_authority_snapshot_expired`.

Authority evaluation uses this exact precedence: a null reference is absent; `effectiveAt > evaluationAt` is future effective; nonnull `expiresAt <= evaluationAt` is expired; declared `unavailable` or `stale` uses that state; declared `future_effective` remains future effective; and the one remaining state is usable. Core checks only the snapshot ID, hash, state, effective time, and expiry. Route, contact, destination, verification, and employer fields remain opaque.

## Source selection and fallback

Source origin is an immutable, evidence-backed assertion:

```text
job_source_position_origin_versions
  PK (source_position_id,version)
  UNIQUE (source_position_id,idempotency_key)
  columns:
    source_position_id, version, predecessor_version,
    listing_material_version, listing_material_hash,
    source_registry_version, source_registry_hash,
    employer_authority_version, employer_authority_hash,
    evidence_set_version, evidence_set_hash,
    predicates_json, origin_class, origin_assertion_hash,
    idempotency_key, created_at

job_source_position_origin_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_origin_versions(source_position_id,version)
```

The version row has predecessor and supporting-version foreign keys, canonical predicate JSON, exact class checks, and immutable update/delete triggers. The head advances one version by CAS and verifies the successor hash.

```ts
interface SourceOriginAssertionV1 {
  sourcePositionId: string;
  version: string;
  listingMaterialVersion: string;
  listingMaterialHash: string;
  sourceRegistryVersion: string;
  sourceRegistryHash: string;
  employerAuthorityVersion: string | null;
  employerAuthorityHash: string | null;
  evidenceSetVersion: string;
  evidenceSetHash: string;
  predicates: {
    employerControlsOrigin: boolean;
    employerAuthorizedSyndication: boolean;
    boardAuthoredPost: boolean;
    intermediaryControlsContact: boolean;
    predicatesConflict: boolean;
  };
  originClass:
    | "employer_controlled"
    | "employer_authorized_syndication"
    | "board_post"
    | "intermediary"
    | "unclassified"
    | "ambiguous";
}
```

`originClass` is derived in predicate order. `predicatesConflict=true`, or more than one true positive predicate without evidence establishing an authorized relationship, produces `ambiguous`. No true predicate produces `unclassified`. The assertion pins all supporting versions and hashes.

`public-content-source-selection-v3` considers current open source positions with current analysis, evidence, allowed mandatory fields, and one approved authored description. It sorts by:

```text
(
  originRank,       // employer_controlled=0,
                    // employer_authorized_syndication=1,
                    // board_post=2, intermediary=3, unclassified=4
  positionRank,     // direct=0, extracted=1
  priorPrimaryRank, // prior primary=0, other=1
  sourcePositionId  // UTF-8 byte order
)
```

An ambiguous origin makes the root private with `source_origin_ambiguous`. The primary supplies title, role facts, workplace and employment types, and the authored description. Canonical organization and locations remain D3 outputs.

Fallback covers `date_posted`, `valid_through`, and `compensation`. It admits current open, allowed, supported assertions and sorts by:

```text
(
  provenanceRank,
  originRank,
  positionRank,
  priorFieldSourceRank,
  sourcePositionId
)
```

Agreement examines the complete minimal rank prefix through `positionRank`. Each field produces one strict envelope:

- Date provenance rank is `employer_original=0`, `board_published=1`.
- Compensation provenance rank is `employer_stated=0`, `board_stated=1`, `product_inferred=2`.
- `originRank` and `positionRank` use the exact primary-source ranks above.
- `priorFieldSourceRank` is evaluated only after all assertions in the minimal prefix have the same typed `valueHash`; prior source is 0 and every other source is 1.
- The last tie-break is source-position ID UTF-8 bytes.

The minimal prefix is the complete set sharing the minimum `(provenanceRank,originRank,positionRank)`. Equal typed value hashes agree. Several value hashes produce `minimal_rank_disagreement`. Empty eligible input produces `no_allowed_open_assertion`. Every input and worker batch order yields the same result.

```ts
type FallbackEnvelopeV3<T> =
  | {
      state: "value";
      reason: "primary" | "fallback_agreement";
      value: T;
      valueHash: string;
      sourcePositionId: string;
    }
  | {
      state: "absent";
      reason: "no_allowed_open_assertion";
      value: null;
      valueHashes: [];
    }
  | {
      state: "conflict";
      reason: "minimal_rank_disagreement";
      value: null;
      valueHashes: string[];
    };
```

Compensation values use canonical decimal strings throughout transport and fact storage. Inferred compensation remains a product-derived fact and stays outside Google `JobPosting.baseSalary`.

## Sealed authored description

```text
job_source_position_authored_description_versions
  PK (source_position_id, version)
  UNIQUE (source_position_id, idempotency_key)
  columns:
    source_position_id, version, predecessor_version,
    listing_material_version, position_payload_version, position_payload_hash,
    evidence_set_version, evidence_set_hash,
    field_policy_input_hash,
    producer_kind=codex|operator|deterministic,
    producer_id, prompt_version,
    sections_json, sections_hash,
    renderer_version=public-description-visible-renderer-v1,
    rendered_text, rendered_text_hash,
    review_state=approved|rejected|needs_review,
    reviewer_kind=operator|deterministic,
    reviewer_id, reviewed_at,
    artifact_hash, idempotency_key, created_at

job_source_position_authored_description_heads
  PK source_position_id
  columns: current_version, current_hash, updated_at
  FK (source_position_id,current_version)
    -> job_source_position_authored_description_versions(
         source_position_id,version
       )
```

The stored JSON schema is exact:

```ts
type DescriptionSectionV1 =
  | "overview"
  | "responsibilities"
  | "qualifications"
  | "teaching_context"
  | "schedule_and_contract"
  | "compensation_and_benefits"
  | "location_and_visa"
  | "application_process"
  | "additional_details";

type DescriptionEvidenceOrdinalsV1 = string[];

type DescriptionBlockV1 =
  | {
      kind: "paragraph";
      text: string;
      evidenceEntryOrdinals: DescriptionEvidenceOrdinalsV1;
    }
  | {
      kind: "bullets";
      items: Array<{
        text: string;
        evidenceEntryOrdinals: DescriptionEvidenceOrdinalsV1;
      }>;
    };

interface DescriptionSectionsV1 {
  sections: Array<{
    section: DescriptionSectionV1;
    blocks: DescriptionBlockV1[];
  }>;
}
```

Sections appear at most once in the fixed renderer order. Overview is nonempty; empty optional sections are omitted. Each paragraph is one block. Adjacent bullets for one section use one `bullets` block. Evidence ordinals are canonical nonnegative integer strings, unique, numerically ascending, and foreign-keyed to the pinned evidence set.

The canonical serializer performs these steps in order:

1. Validate the closed schema, fixed section order, block order, evidence references, and applicable limits.
1. Convert CRLF and CR to LF. Validate Unicode 16.0.0 scalars, reject leading or trailing Unicode whitespace per text value, and reject C0/C1 controls except LF.
1. Preserve accepted text bytes. Preserve block and bullet order. Sort each evidence-ordinal array numerically.
1. Emit the one `jobkit-canonical-json-v1` byte stream. Every object key, including `DescriptionSectionsV1` records and union variants, sorts by exact UTF-8 bytes. Strings follow the global serializer's escapes; accepted scalars otherwise emit as UTF-8.
1. Hash the resulting bytes with `descriptionSectionsHash` and store those same bytes in `sections_json`.

The minimal description vector in the global canonical-JSON table is normative. Its block object serializes `evidenceEntryOrdinals`, `kind`, then `text`; its section object serializes `blocks`, then `section`. Renderer section order governs the `sections` array and leaves object-key ordering unchanged. The authored-description builder, storage writer, hash registry, candidate reader, and downstream DTO renderer consume the same stored bytes. The contract defines one description serializer.

An artifact admits at most nine sections, 128 blocks, 256 bullet items, 256 evidence ordinals per block or item, 16,384 UTF-8 bytes per text value, and 262,144 UTF-8 bytes for canonical `sections_json`. N and N+1 fixtures cover each boundary.

Core pins the artifact and the `public-description-builder-v3` inputs. `public-description-visible-renderer-v1` emits the exact visible UTF-8 prose consumed by `outputTextHash`, verbatim-overlap offsets, review UI, and downstream `public-description-v2` rendering.

The renderer uses this closed label map and section order:

| Section                     | Visible heading             |
| --------------------------- | --------------------------- |
| `overview`                  | `Overview`                  |
| `responsibilities`          | `Responsibilities`          |
| `qualifications`            | `Qualifications`            |
| `teaching_context`          | `Teaching context`          |
| `schedule_and_contract`     | `Schedule and contract`     |
| `compensation_and_benefits` | `Compensation and benefits` |
| `location_and_visa`         | `Location and visa`         |
| `application_process`       | `Application process`       |
| `additional_details`        | `Additional details`        |

It renders each present section as a Markdown-compatible plain-text section:

1. Emit ASCII `##`, one space, the exact visible heading, and LF.
1. Emit one LF, producing one blank line after the heading.
1. Render blocks in stored order. A paragraph emits its exact `text`. A bullets block emits each item as ASCII `-`, one space, and its exact `text`, joining items with one LF. Bullet-item text contains zero LF scalars; paragraph text may contain LF and preserves each one.
1. Join adjacent blocks with exactly two LF bytes.
1. Join adjacent sections with exactly two LF bytes.
1. Append exactly one final LF byte to the complete output.

The rendered output starts with its first heading and consists only of exact headings, list markers, accepted text, and LF separators. Section headings and list markers are part of the visible prose bytes. `rendered_text_hash=registeredBytesHash("outputTextHash",UTF8(rendered_text))`. The verbatim checker normalizes `rendered_text` for comparison and records offsets as half-open Unicode-code-point offsets into that normalized visible string. Source offsets use the same half-open convention in the separately normalized source string. Stored UTF-8 byte offsets remain source-evidence coordinates; normalized overlap uses the code-point offsets.

The renderer golden vectors are exact:

| Semantic input                                                                         | Visible UTF-8 bytes with escapes                                                        | Raw SHA-256                                                        |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Minimal description vector above                                                       | `## Overview\n\nTeach.\n`                                                               | `f9c19dd69e8d99aad4c448920dedb0c5fe1c7eed61af352411227cdf4f92d362` |
| Overview `Teach.` plus Responsibilities bullets `Plan lessons.` and `Assess progress.` | `## Overview\n\nTeach.\n\n## Responsibilities\n\n- Plan lessons.\n- Assess progress.\n` | `f98b90fe0b07ce7fe50275297cc238cb842e29dd5da161e016fae2dca077fa43` |

TypeScript, Go, Rust, and SQLite fixtures must reproduce both byte strings, raw SHA-256 values, registered `outputTextHash` values, and normalized overlap offsets. A publishable artifact contains a nonempty Overview. Empty optional sections are omitted.

### Privacy, verbatim overlap, and attribution

`public-verbatim-overlap-v1` compares visible authored prose with each contributing source after Unicode 16.0.0 NFKC, LF line endings, collapsed whitespace, and case folding. Structured title, organization, location, date, and numeric compensation literals stay outside comparison only when they appear solely in structured facts. The check records source and output text hashes, maximum contiguous shared normalized code-point substring, offsets, length, configured limit, and result. Equality at the limit passes; one additional code point fails.

Attribution pins effective policy, label version and hash, URL policy, sanitizer version, sanitized output, and output hash. `public-source-url-sanitizer-v1` accepts absolute HTTPS URLs with empty credentials and fragment, restricts hosts and query keys to effective-policy allowlists, removes sensitive keys, sorts retained pairs by encoded bytes, and emits either the normalized URL or `unsafe_source_url`.

## Lifecycle action authority

Core owns the lifecycle authority needed to derive per-root outcomes. Migration 0042 defines the only current roles as `member` and `operator`; lifecycle authoring requires `users.role='operator'`.

```text
public_job_lifecycle_action_versions
  PK (public_job_id, version)
  UNIQUE (public_job_id, idempotency_key)
  columns:
    public_job_id, version, predecessor_version,
    action=close|reopen|suppress|clear_suppression|delete|rollback_merge,
    requested_state, evidence_json, evidence_hash,
    authorized_user_id, authorized_at, effective_at,
    expires_at, action_hash,
    idempotency_key,
    created_core_transaction_id, created_core_slot_ordinal,
    created_core_witness_hash, created_at
  FK public_job_id -> public_jobs(id)
  FK authorized_user_id -> users(id)
  FK (public_job_id,predecessor_version)
    -> public_job_lifecycle_action_versions(public_job_id,version)
  CHECK first version has null predecessor
  CHECK successor predecessor equals version-1

public_job_lifecycle_action_heads
  PK public_job_id
  columns:
    public_job_id, current_version, current_hash,
    last_core_transaction_id, last_core_slot_ordinal,
    last_core_witness_hash, updated_at
  FK (public_job_id,current_version)
    -> public_job_lifecycle_action_versions(public_job_id,version)

public_job_lifecycle_action_revocations
  PK (public_job_id, action_version, revocation_version)
  UNIQUE (public_job_id,action_version,idempotency_key)
  columns:
    public_job_id, action_version, revocation_version,
    predecessor_revocation_version,
    authorized_user_id, reason_code, effective_at,
    revocation_hash, idempotency_key,
    created_core_transaction_id, created_core_slot_ordinal,
    created_core_witness_hash, created_at
  FK (public_job_id,action_version)
    -> public_job_lifecycle_action_versions(public_job_id,version)
  FK authorized_user_id -> users(id)
  FK (public_job_id,action_version,predecessor_revocation_version)
    -> public_job_lifecycle_action_revocations(
         public_job_id,action_version,revocation_version
       )

public_job_lifecycle_action_revocation_heads
  PK (public_job_id, action_version)
  columns:
    current_version, current_hash,
    last_core_transaction_id, last_core_slot_ordinal,
    last_core_witness_hash, updated_at
  FK (public_job_id,action_version,current_version)
    -> public_job_lifecycle_action_revocations(
         public_job_id,action_version,revocation_version
       )

public_job_lifecycle_causal_events
  PK event_id
  UNIQUE event_hash
  columns:
    event_id, event_kind=action_authored|action_revoked,
    public_job_id, action_version, action_hash,
    revocation_version, revocation_hash,
    effective_at, expires_at, predecessor_hash,
    payload_json, payload_json_hash, event_hash,
    created_core_transaction_id, created_core_slot_ordinal,
    created_core_witness_hash, created_at
  FK (public_job_id,action_version)
    -> public_job_lifecycle_action_versions(public_job_id,version)
  FK (public_job_id,action_version,revocation_version)
    -> public_job_lifecycle_action_revocations(
         public_job_id,action_version,revocation_version
       )

public_job_lifecycle_outbox
  PK event_id
  UNIQUE delivery_key
  columns:
    event_id, topic=public_job_lifecycle, delivery_key,
    payload_json, payload_json_hash, outbox_payload_hash,
    state=pending|claimed|delivered,
    claimed_at, delivered_at,
    created_core_transaction_id, created_core_slot_ordinal,
    created_core_witness_hash, created_at, updated_at
  FK event_id -> public_job_lifecycle_causal_events(event_id)
```

Lifecycle action and revocation version rows are immutable after insert. Head rows are mutable CAS selectors. A first action head inserts only for version one while the head is absent. A successor head update is exactly:

```sql
UPDATE public_job_lifecycle_action_heads
SET current_version=:successorVersion,
    current_hash=:successorHash,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    last_core_transaction_id=:transactionId,
    last_core_slot_ordinal=:slotOrdinal,
    last_core_witness_hash=:witnessHash
WHERE public_job_id=:publicJobId
  AND current_version=:predecessorVersion
  AND current_hash=:predecessorHash;
```

The successor version must have `predecessor_version=:predecessorVersion`, and `:successorVersion=:predecessorVersion+1`. The revocation-head CAS has the same shape under `(public_job_id,action_version)`. Head-delete triggers always abort. Head-update triggers admit only the owning lifecycle-authority entry point, a one-version successor, the matching predecessor row, the matching successor hash, and its counted-operation witness. The database authorizer rejects direct updates with another SQL fingerprint.

Head absence is a complete, valid lifecycle state. Each root intent carries either both lifecycle action fields as null or both as nonnull. A null pair means `expected action head state=absent`; request sealing executes `NOT EXISTS (SELECT 1 FROM public_job_lifecycle_action_heads WHERE public_job_id=:publicJobId)`. A nonnull pair must equal the current head and its immutable version row. A missing referenced head or version yields `lifecycle_authority_missing`; an existing but different head yields `dependency_head_drift`; a row/hash mismatch yields `dependency_hash_mismatch`. Candidate acceptance repeats the same positive or negative head assertion. Creation of a first head after a request sealed with an absence expectation therefore supersedes the processing generation.

An absent action head causes predecessor state and request intent to govern. An absent revocation head establishes zero effective revocations for the inspected action at `evaluationAt`; preparation and acceptance both reassert that absence. Existing zero-source roots use predecessor state and request intent directly. This exact absence behavior applies to preexisting and newly created `public_jobs` identities.

`LifecycleEventKindV1` is `action_authored` or `action_revoked`. An authored event payload is `{eventKind,publicJobId,actionVersion,actionHash,revocationVersion:null,revocationHash:null,effectiveAt,expiresAt,predecessorHash}`. A revoked event payload uses the inspected action version and hash, the exact revocation version and hash, revocation effective time, null expiry, and the predecessor revocation hash. It is serialized with `jobkit-canonical-json-v1`; `lifecycleCausalEventHash` covers the typed payload; `event_id=registeredIdentifier("lifecycleCausalEventId",eventHash)`. `payload_json_hash` is `registeredBytesHash("lifecycleEventPayloadJsonHash",payloadBytes)`.

The outbox payload is `{eventId,eventHash,eventKind,publicJobId,actionVersion,actionHash,revocationVersion,revocationHash,effectiveAt,expiresAt}`. It is canonical JSON. `delivery_key` equals `event_id`; topic is exactly `public_job_lifecycle`; `lifecycleOutboxPayloadHash` covers event ID/hash, topic, and payload JSON hash. The action-event partial unique index is `(public_job_id,action_version,event_kind) WHERE revocation_version IS NULL`. The revocation-event partial unique index is `(public_job_id,action_version,revocation_version,event_kind) WHERE revocation_version IS NOT NULL`. Event rows reject update/delete. Outbox state is operational, while its identity, topic, delivery key, payload, hashes, and creation time are immutable.

Action authoring first reads `(public_job_id,idempotency_key)`. A matching action hash returns the existing action, event, and outbox row as a zero-write replay. Another hash returns `lifecycle_idempotency_conflict`. A missing row executes `lifecycle-action-author-first-v2` or `lifecycle-action-author-successor-v2`: insert context; assert one authorized operator; insert and assert the version; insert or CAS-update and assert the head; insert and assert the causal event; insert and assert the outbox row; insert the fail-closed receipt. The successor CAS is `WHERE current_version=:predecessorVersion AND current_hash=:predecessorHash`. A unique race retries the preflight read. The first action requires version one and a missing head.

Revocation uses the same preflight and the first-or-successor lifecycle-revocation template scoped by `(public_job_id,action_version,idempotency_key)`. It inserts or advances the exact revocation head, event, and outbox rows with five slots and one receipt. Version rows reject update/delete; head rows follow the insert-or-CAS rules above. Each authoring template uses eleven statements under the counted protocol and stays within the 20-statement core ceiling.

Every action row inspected while walking effective time becomes dependency `{kind:"lifecycle_action",key:publicJobId,version:canonicalActionVersion,hash:actionHash}`. Every revocation row inspected becomes `{kind:"lifecycle_revocation",key:publicJobId + U+001F + canonicalActionVersion,version:canonicalRevocationVersion,hash:revocationHash}`. This includes future-effective, expired, and superseded chain members visited before the selected action is known. Head assertions cover every inspected chain's current version and hash.

Effective-time selection starts at the authored action head when one exists and follows the immutable predecessor chain toward version one. It selects the first action for which `effective_at <= evaluationAt`, `expires_at IS NULL OR evaluationAt < expires_at`, and the effective revocation count at `evaluationAt` equals zero. A future-effective or expired head therefore leaves an eligible predecessor in force. An absent head or a chain lacking a qualifying action delegates the outcome to predecessor state and request intent. The selected action version/hash and every inspected revocation version/hash enter the dependency closure. Positive and negative head assertions cover every inspected chain. Scheduled expiry activation belongs to the catalog and temporal contract.

## Per-root outcomes

Each component contains one outcome for every requested root, D3 winner, D3 loser, and mapping predecessor touched by the component:

```ts
type RootStateV1 =
  | "new"
  | "private"
  | "eligible"
  | "published"
  | "closed"
  | "suppressed"
  | "deleted"
  | "merged";

type PublicationIntentV1 =
  | "preserve_existing"
  | "private"
  | "eligible"
  | "published"
  | "closed"
  | "suppressed"
  | "deleted";

type DerivedIntentV1 = PublicationIntentV1 | "merged";

interface RootOutcomeV3 {
  publicJobId: string;
  rootRole: "winner" | "loser" | "lifecycle";
  predecessorState: RootStateV1;
  requestedIntent: PublicationIntentV1;
  derivedIntent: DerivedIntentV1;
  desiredState: RootStateV1;
  effectiveState: RootStateV1;
  intentSatisfied: boolean;
  lifecycleActionVersion: string | null;
  lifecycleActionHash: string | null;
  allocationDisposition: "reuse" | "create" | "merge" | "detach" | "none";
  contentIntent: "reuse" | "advance" | "none";
  applicationAuthoritySnapshotId: string | null;
  primaryReasonCode: CoreReasonCodeV1 | null;
  reasonCodes: CoreReasonCodeV1[];
}
```

Resolution precedence is:

1. A deleted predecessor remains deleted; an allocation edge touching it blocks the component with `terminal_root_allocation_conflict`.
1. A merged predecessor remains merged unless an authorized rollback restores it. Selection as a D3 winner otherwise blocks with `merged_root_selected_as_winner`.
1. A D3 loser derives merged. A conflicting explicit intent blocks with `root_intent_allocation_conflict`.
1. The winner or lifecycle root applies a current authorized lifecycle action.
1. Suppressed and closed predecessors preserve their state until an authorized clearance or reopen applies.
1. A fully closed source aggregate derives closed.
1. `preserve_existing` retains the predecessor; a new winner maps it to private.
1. Remaining private, eligible, or published intents pass through readiness gates.

A readiness miss produces private state, `intentSatisfied=false`, and the full reason set. Every lifecycle root resolves independently.

### Zero-source terminal roots

An existing root may produce a terminal outcome with zero mapped positions when the request pins:

- an existing public identity and predecessor state;
- a current content snapshot hash;
- a current eligibility snapshot hash;
- an exact lifecycle-head expectation, including verified absence; and
- a current application-authority snapshot when its desired state needs one.

The candidate emits `contentIntent=reuse`, null canonical source, null authored description, and the predecessor content hash. Deleted, suppressed, merged, and preserved closed roots preserve terminal semantics without synthesizing prose. Missing minimum state blocks with `terminal_root_missing_public_snapshot`. A new root with zero positions blocks with `new_root_missing_source`.

The reused predecessor is represented by a `reused_content` fact. Its value pins the predecessor content version and hash, predecessor public-content hash, and `reasonCode="zero_source_terminal_reuse"`. This typed fact makes zero-source content part of the fact reduction rather than an untyped side channel.

## Typed candidate facts

Facts are strict semantic records rather than destination-table rows:

```ts
type CandidateFactKindV1 =
  | "root_outcome"
  | "identity_allocation"
  | "source_mapping_intent"
  | "canonical_content"
  | "canonical_organization"
  | "canonical_locations"
  | "canonical_source_binding"
  | "field_source_binding"
  | "resolution_source_binding"
  | "description_evidence"
  | "source_attribution"
  | "verbatim_check"
  | "eligibility_intent"
  | "lifecycle_transition_intent"
  | "application_authority_pin"
  | "reused_content";

type CandidateFactValueV1 =
  | {
      schema: "root-outcome-v3";
      outcome: RootOutcomeV3;
    }
  | {
      schema: "identity-allocation-v1";
      allocationHash: string;
      winnerPublicJobId: string;
      loserPublicJobIds: string[];
    }
  | {
      schema: "source-mapping-intent-v1";
      sourcePositionId: string;
      predecessorPublicJobId: string | null;
      successorPublicJobId: string;
      mappingIntent: "reuse" | "attach" | "detach" | "merge";
    }
  | {
      schema: "canonical-content-v1";
      title: string;
      workplaceType: "onsite" | "hybrid" | "remote";
      employmentTypes: string[];
      datePosted: FallbackEnvelopeV3<string>;
      validThrough: FallbackEnvelopeV3<string>;
      compensation: FallbackEnvelopeV3<{
        minimum: CanonicalDecimalText | null;
        maximum: CanonicalDecimalText | null;
        currency: string;
        period: string;
      }>;
      descriptionArtifactHash: string;
    }
  | {
      schema: "canonical-organization-v1";
      canonicalOrganizationId: string;
      resolutionHash: string;
      decisiveEvidenceHashes: string[];
    }
  | {
      schema: "canonical-locations-v1";
      resolutionHash: string;
      orderedCanonicalLocationIds: string[];
      decisiveEvidenceHashes: string[];
    }
  | {
      schema:
        | "canonical-source-binding-v1"
        | "field-source-binding-v1"
        | "resolution-source-binding-v1";
      fieldName: string;
      ordinal: string;
      sourcePositionId: string;
      assertionHash: string;
    }
  | {
      schema: "description-evidence-v1";
      artifactHash: string;
      evidenceSetHash: string;
      evidenceEntryOrdinals: string[];
    }
  | {
      schema: "source-attribution-v1";
      sourcePositionId: string;
      policyHash: string;
      labelHash: string;
      sanitizedUrlHash: string | null;
    }
  | {
      schema: "verbatim-check-v1";
      sourcePositionId: string;
      sourceTextHash: string;
      outputTextHash: string;
      maximumSharedCodePoints: string;
      passed: boolean;
    }
  | {
      schema: "eligibility-intent-v1";
      desiredState: RootStateV1;
      effectiveState: RootStateV1;
      reasonCodes: CoreReasonCodeV1[];
    }
  | {
      schema: "lifecycle-transition-intent-v1";
      predecessorState: RootStateV1;
      successorState: RootStateV1;
      actionVersion: string | null;
      actionHash: string | null;
    }
  | {
      schema: "application-authority-pin-v1";
      snapshotRef: ApplicationAuthoritySnapshotRefV1 | null;
      readiness: "usable" | "private";
      reasonCode: CoreReasonCodeV1 | null;
    }
  | {
      schema: "reused-content-v1";
      publicJobId: string;
      predecessorContentVersion: string;
      predecessorContentHash: string;
      predecessorPublicContentHash: string;
      reasonCode: "zero_source_terminal_reuse";
    };

interface CandidateFactEnvelopeV1 {
  kind: CandidateFactKindV1;
  naturalKey: string[];
  schemaVersion: string;
  value: CandidateFactValueV1;
  evidenceRefs: Array<{
    evidenceKind: string;
    evidenceKey: string;
    evidenceVersion: string;
    evidenceHash: string;
  }>;
}
```

Fact-kind rank is 0 through 15 in the union order above. Every fact kind maps to exactly one value schema. Its exact natural key and uniqueness scope are:

| Fact kind                     | Exact schema version             | Ordered natural-key fields            |
| ----------------------------- | -------------------------------- | ------------------------------------- |
| `root_outcome`                | `root-outcome-v3`                | `publicJobId`                         |
| `identity_allocation`         | `identity-allocation-v1`         | `winnerPublicJobId`                   |
| `source_mapping_intent`       | `source-mapping-intent-v1`       | `sourcePositionId`                    |
| `canonical_content`           | `canonical-content-v1`           | `publicJobId`                         |
| `canonical_organization`      | `canonical-organization-v1`      | `publicJobId`                         |
| `canonical_locations`         | `canonical-locations-v1`         | `publicJobId`                         |
| `canonical_source_binding`    | `canonical-source-binding-v1`    | `publicJobId`                         |
| `field_source_binding`        | `field-source-binding-v1`        | `publicJobId`, `fieldName`, `ordinal` |
| `resolution_source_binding`   | `resolution-source-binding-v1`   | `publicJobId`, `fieldName`, `ordinal` |
| `description_evidence`        | `description-evidence-v1`        | `publicJobId`                         |
| `source_attribution`          | `source-attribution-v1`          | `publicJobId`, `sourcePositionId`     |
| `verbatim_check`              | `verbatim-check-v1`              | `publicJobId`, `sourcePositionId`     |
| `eligibility_intent`          | `eligibility-intent-v1`          | `publicJobId`                         |
| `lifecycle_transition_intent` | `lifecycle-transition-intent-v1` | `publicJobId`                         |
| `application_authority_pin`   | `application-authority-pin-v1`   | `publicJobId`                         |
| `reused_content`              | `reused-content-v1`              | `publicJobId`                         |

Every field is exact UTF-8 text; `fieldName` validates against `CandidateFieldNameV1`, and ordinal fields use canonical nonnegative integer text. `candidateFactNaturalKeyHash` hashes the kind and ordered fields. Storage has `UNIQUE(run_id,component_id,generation,plan_hash,fact_kind,natural_key_hash)`. Evidence references sort by kind, key, version, and hash bytes. `candidateFactHash` hashes the complete envelope. Facts sort by the closed fact-kind rank above followed by encoded natural-key bytes before `candidateFactDigest` reduction.

## Plan, generation, pages, and leases

Core relations are:

```text
public_projection_candidate_items
  PK (run_id, component_id)
  UNIQUE (run_id, component_id, component_kind)
  columns:
    component_kind=allocation|lifecycle_root|blocked_allocation,
    state=queued|processing|retryable|sealed|blocked|failed|superseded,
    attempt_count, max_attempts,
    lease_owner, lease_token, lease_epoch, lease_expires_at,
    next_generation, accepted_generation,
    primary_reason_code, reason_codes_json,
    last_core_transaction_id, last_core_slot_ordinal,
    last_core_witness_hash,
    created_at, updated_at
  FK (run_id,component_id,component_kind)
    -> public_projection_candidate_components(
         run_id,component_id,component_kind
       )

public_projection_candidate_generations
  PK (run_id, component_id, generation)
  UNIQUE (run_id, component_id, generation, component_kind)
  columns:
    component_kind=allocation|lifecycle_root|blocked_allocation,
    predecessor_generation,
    state=processing|sealed|blocked|failed|superseded,
    plan_hash, dependency_digest,
    claim_lease_token, claim_lease_epoch,
    primary_reason_code, reason_codes_json,
    created_core_transaction_id, created_core_slot_ordinal,
    created_core_witness_hash,
    last_core_transaction_id, last_core_slot_ordinal,
    last_core_witness_hash,
    created_at, terminal_at
  FK (run_id,component_id,component_kind)
    -> public_projection_candidate_items(
         run_id,component_id,component_kind
       )

public_projection_candidate_run_accounting
  PK run_id
  columns:
    total_count, queued_count, processing_count, retryable_count,
    sealed_count, blocked_count, failed_count, superseded_count,
    state=building|sealed, updated_at
  FK run_id -> public_projection_runs(id)
  CHECK every count is a nonnegative integer
  CHECK total_count = queued_count + processing_count + retryable_count
    + sealed_count + blocked_count + failed_count + superseded_count

public_projection_candidate_plans
  PK (run_id,component_id,generation,plan_hash)
  UNIQUE (run_id,component_id,generation)
  columns:
    request_key, component_hash, dependency_digest,
    root_set_digest, source_selection_digest,
    field_decision_digest, source_binding_digest, fallback_digest,
    description_artifact_digest, expected_fact_kinds_json,
    expected_fact_count, canonical_plan_json,
    canonical_plan_byte_count, state=sealed, created_at, sealed_at
  FK (run_id,component_id,generation)
    -> public_projection_candidate_generations(run_id,component_id,generation)
  FK request_key -> public_projection_requests(request_key)

public_projection_candidate_fact_pages
  PK (run_id, component_id, generation, plan_hash, page_ordinal)
  columns:
    first_fact_ordinal, fact_count, page_byte_count,
    previous_page_hash, page_hash,
    state=writing|sealed, created_at, sealed_at
  UNIQUE (run_id,component_id,generation,plan_hash,page_hash)
  FK (run_id,component_id,generation,plan_hash)
    -> public_projection_candidate_plans(
         run_id,component_id,generation,plan_hash
       )

public_projection_candidate_facts
  PK (run_id, component_id, generation, plan_hash, fact_ordinal)
  UNIQUE (run_id, component_id, generation, plan_hash, fact_hash)
  UNIQUE (
    run_id,component_id,generation,plan_hash,fact_kind,natural_key_hash
  )
  columns:
    page_ordinal, fact_kind, natural_key_json, natural_key_hash,
    schema_version, value_json, evidence_refs_json,
    canonical_fact_json, canonical_fact_byte_count, fact_hash, created_at
  FK (run_id,component_id,generation,plan_hash)
    -> public_projection_candidate_plans(
         run_id,component_id,generation,plan_hash
       )
  FK (run_id,component_id,generation,plan_hash,page_ordinal)
    -> public_projection_candidate_fact_pages(
         run_id,component_id,generation,plan_hash,page_ordinal
       )
  CHECK page_ordinal=fact_ordinal
```

Every staged child key begins with `(run_id,component_id,generation,plan_hash)`. Staged children contain zero `candidate_id` values. A plan inserts only for `allocation` or `lifecycle_root` while its generation is processing under the current lease. A trigger rejects a plan, field decision, fact page, or fact whose generation has `component_kind='blocked_allocation'`. The insert transaction validates the canonical plan, inserts one sealed plan, writes its row-count assertion, and copies `plan_hash` to the generation through a one-row CAS. Triggers reject plan update/delete and reject fact/page update/delete after page sealing. A generation accepts one plan.

The candidate-item insert and every item-state transition update `public_projection_candidate_run_accounting` in the same counted transaction through two row-local triggers. The insert trigger increments `total_count` and `queued_count` while accounting state is `building`. The state-update trigger decrements the column named by `OLD.state` and increments the column named by `NEW.state` while accounting state is `sealed`; SQL uses one closed `CASE WHEN OLD.state=... THEN 1 ELSE 0 END` expression and one equivalent `NEW.state` expression for each of the seven states. The item mutation's operation-specific assertion joins the accounting row and validates the complete eight-count vector and its sum. A missing accounting update therefore produces zero assertion rows and aborts at receipt. Sealing component discovery checks `total_count` against the immutable component count and changes accounting state to `sealed`. Migration-0049 listing and position counters retain their existing meanings, while candidate accounting uses its dedicated relation.

The plan schema is:

```ts
interface CandidatePlanV4 {
  requestKey: string;
  componentId: string;
  componentKind: "allocation" | "lifecycle_root";
  componentHash: string;
  allocationHash: string | null;
  rootSetDigest: string;
  dependencyDigest: string;
  effectiveAuthorityHeads: AuthorityHeadRefV1[];
  applicationAuthoritySnapshotPinHash: string | null;
  sourceSelectionDigest: string;
  fieldDecisionDigest: string;
  sourceBindingDigest: string;
  fallbackDigest: string;
  descriptionArtifactDigest: string | null;
  expectedFactKinds: CandidateFactKindV1[];
  expectedFactCount: string;
}
```

`CandidatePlanV4.componentKind` intentionally excludes `blocked_allocation`. That kind terminates before plan construction and is represented only by component, item, generation, dependency, accounting, and terminal-seal rows.

```text
planHash = registeredRecordHash("planHash", CandidatePlanV4)
```

`effectiveAuthorityHeads` sorts by authority kind and key UTF-8 bytes. `expectedFactKinds` deduplicates and sorts by fact-kind rank. `expectedFactCount` is a canonical nonnegative integer string. `planHash` excludes fact hashes, page hashes, fact reductions, candidate ID, candidate semantic hash, and seal hash. The worker computes the plan before writing facts, materializes and seals fact pages under the plan key, reduces all facts and pages, and derives candidate identity afterward.

`public-candidate-fact-page-v1` assigns one sorted fact to each page. Page ordinal equals fact ordinal, `first_fact_ordinal` equals fact ordinal, and `fact_count` equals one. `page_byte_count` is the UTF-8 byte length of the full canonical page envelope, including page metadata, the complete canonical fact envelope, and its hash. A one-fact page therefore remains subject to the 327,680-byte page ceiling as well as the 262,144-byte fact ceiling.

Page zero sets `previous_page_hash` to `registeredRecordHash("candidateFactPageZeroPredecessorHash", {planHash})`. Page `n>0` sets it to the sealed `page_hash` at `n-1`. The page-seal transaction uses a composite foreign-key lookup to the sealed plan, asserts a continuous predecessor chain and one exact fact row, computes canonical bytes and counts, and changes `writing` to `sealed` under the live lease. `candidateFactPageHash` covers page ordinal, first fact ordinal, fact count, full canonical page byte count, prior page hash, and the one raw fact hash. `candidateFactPageDigest` reduces page hashes by numeric page ordinal.

### D1 server-clock lease protocol

`leaseDurationMs=120000` and `maxAttempts=3`. A new item has `attempt_count=0`, `lease_epoch=0`, `next_generation=1`, and null lease and accepted-generation fields. Tokens are 32 lowercase hexadecimal bytes generated from 16 random bytes before the transaction. Every time comparison uses D1:

```sql
strftime('%Y-%m-%dT%H:%M:%fZ','now')
```

Expiry uses `strftime('%Y-%m-%dT%H:%M:%fZ','now','+120 seconds')`. D1 time is the sole clock input.

Every core transaction receives a random `transaction_id` and uses `public-counted-transaction-v2`. Version two binds each assertion to one closed template slot, operation, target kind, target key, fixed mutation SQL fingerprint, fixed postcondition SQL fingerprint, and mutation-coupled witness. Operation-specific target reads replace SQLite's ambient `changes()` register.

The migration installs these D1-compatible relations and triggers:

```sql
CREATE TABLE public_projection_core_transaction_templates (
  template_id TEXT PRIMARY KEY,
  expected_slot_count INTEGER NOT NULL CHECK (expected_slot_count>0),
  template_hash TEXT NOT NULL CHECK (length(template_hash)=64),
  created_at TEXT NOT NULL,
  UNIQUE (template_id,expected_slot_count,template_hash)
);

CREATE TABLE public_projection_core_template_slots (
  template_id TEXT NOT NULL,
  slot_ordinal INTEGER NOT NULL CHECK (slot_ordinal>=0),
  operation TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  min_rows INTEGER NOT NULL CHECK (min_rows>=0),
  max_rows INTEGER NOT NULL CHECK (max_rows>=min_rows),
  target_key_schema_hash TEXT NOT NULL
    CHECK (length(target_key_schema_hash)=64),
  postcondition_schema_hash TEXT NOT NULL
    CHECK (length(postcondition_schema_hash)=64),
  mutation_sql_hash TEXT NOT NULL CHECK (length(mutation_sql_hash)=64),
  assertion_sql_hash TEXT NOT NULL CHECK (length(assertion_sql_hash)=64),
  slot_hash TEXT NOT NULL CHECK (length(slot_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id,slot_ordinal),
  UNIQUE (
    template_id,slot_ordinal,operation,target_kind,
    min_rows,max_rows,slot_hash
  ),
  FOREIGN KEY (template_id)
    REFERENCES public_projection_core_transaction_templates(template_id)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_core_transaction_contexts (
  transaction_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_hash TEXT NOT NULL CHECK (length(template_hash)=64),
  scope_key_json TEXT NOT NULL CHECK (json_valid(scope_key_json)),
  scope_key_hash TEXT NOT NULL CHECK (length(scope_key_hash)=64),
  expected_slot_count INTEGER NOT NULL CHECK (expected_slot_count>0),
  next_slot_ordinal INTEGER NOT NULL DEFAULT 0
    CHECK (next_slot_ordinal>=0),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','sealed')),
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  UNIQUE (transaction_id,template_id),
  FOREIGN KEY (template_id,expected_slot_count,template_hash)
    REFERENCES public_projection_core_transaction_templates(
      template_id,expected_slot_count,template_hash
    ) ON DELETE RESTRICT
);

CREATE TABLE public_projection_core_transaction_assertions (
  transaction_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  assertion_ordinal INTEGER NOT NULL CHECK (assertion_ordinal>=0),
  operation TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  min_rows INTEGER NOT NULL,
  max_rows INTEGER NOT NULL,
  slot_hash TEXT NOT NULL CHECK (length(slot_hash)=64),
  target_key_hash TEXT NOT NULL CHECK (length(target_key_hash)=64),
  witness_hash TEXT NOT NULL CHECK (length(witness_hash)=64),
  actual_rows INTEGER NOT NULL,
  passed INTEGER NOT NULL CHECK (passed=1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (transaction_id,assertion_ordinal),
  FOREIGN KEY (transaction_id,template_id)
    REFERENCES public_projection_core_transaction_contexts(
      transaction_id,template_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (
    template_id,assertion_ordinal,operation,target_kind,
    min_rows,max_rows,slot_hash
  ) REFERENCES public_projection_core_template_slots(
    template_id,slot_ordinal,operation,target_kind,
    min_rows,max_rows,slot_hash
  ) ON DELETE RESTRICT,
  CHECK (min_rows<=actual_rows AND actual_rows<=max_rows)
);

CREATE TABLE public_projection_core_transaction_receipts (
  transaction_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_hash TEXT NOT NULL CHECK (length(template_hash)=64),
  expected_slot_count INTEGER NOT NULL,
  actual_assertion_count INTEGER NOT NULL,
  passed INTEGER NOT NULL CHECK (passed=1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id,template_id)
    REFERENCES public_projection_core_transaction_contexts(
      transaction_id,template_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (template_id,expected_slot_count,template_hash)
    REFERENCES public_projection_core_transaction_templates(
      template_id,expected_slot_count,template_hash
    ) ON DELETE RESTRICT,
  CHECK (expected_slot_count=actual_assertion_count)
);

CREATE TRIGGER public_projection_core_assertion_in_order
BEFORE INSERT ON public_projection_core_transaction_assertions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_projection_core_transaction_contexts AS context
    WHERE context.transaction_id=NEW.transaction_id
      AND context.template_id=NEW.template_id
      AND context.state='open'
      AND context.next_slot_ordinal=NEW.assertion_ordinal
  ) THEN RAISE(ABORT,'core assertion slot is out of order') END;
END;

CREATE TRIGGER public_projection_core_assertion_advance
AFTER INSERT ON public_projection_core_transaction_assertions
BEGIN
  UPDATE public_projection_core_transaction_contexts
  SET next_slot_ordinal=next_slot_ordinal+1
  WHERE transaction_id=NEW.transaction_id
    AND template_id=NEW.template_id
    AND state='open'
    AND next_slot_ordinal=NEW.assertion_ordinal;
END;

CREATE TRIGGER public_projection_core_receipt_complete
BEFORE INSERT ON public_projection_core_transaction_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_projection_core_transaction_contexts AS context
    WHERE context.transaction_id=NEW.transaction_id
      AND context.template_id=NEW.template_id
      AND context.template_hash=NEW.template_hash
      AND context.state='open'
      AND context.expected_slot_count=NEW.expected_slot_count
      AND context.next_slot_ordinal=NEW.expected_slot_count
      AND NEW.actual_assertion_count=(
        SELECT COUNT(*)
        FROM public_projection_core_transaction_assertions AS assertion
        WHERE assertion.transaction_id=NEW.transaction_id
      )
  ) THEN RAISE(ABORT,'core transaction receipt is incomplete') END;
END;

CREATE TRIGGER public_projection_core_receipt_seal
AFTER INSERT ON public_projection_core_transaction_receipts
BEGIN
  UPDATE public_projection_core_transaction_contexts
  SET state='sealed',sealed_at=NEW.created_at
  WHERE transaction_id=NEW.transaction_id
    AND template_id=NEW.template_id
    AND state='open';
END;
```

Template, slot, assertion, and receipt rows reject update and delete. Context rows admit only the two trigger-owned transitions: increment `next_slot_ordinal` by one while open, or change open to sealed while preserving every identity field and ordinal. The database authorizer rejects application-issued context updates.

Every mutable domain target carries `last_core_transaction_id`, `last_core_slot_ordinal`, and `last_core_witness_hash`. Every immutable inserted target carries the corresponding `created_core_*` columns. `scope_key_hash=registeredBytesHash("coreTransactionScopeKeyHash",UTF8(scope_key_json))`; `target_key_hash=registeredBytesHash("coreTargetKeyHash",UTF8(canonicalTargetKeyJson))`; and `coreMutationWitnessHash` covers `{transactionId,templateId,slotOrdinal,slotHash,targetKeyHash}`. The mutation writes that witness into its target row. The immediately following operation-specific assertion uses `INSERT ... SELECT` from the exact target natural key and checks the complete declared postcondition plus those witness columns. A zero-row mutation therefore produces zero assertion rows; the fail-closed receipt aborts the whole batch.

`target_key_schema_hash`, `postcondition_schema_hash`, `mutation_sql_hash`, and `assertion_sql_hash` are SHA-256 digests of canonical schema JSON or exact UTF-8 SQL constants installed by the migration. `slot_hash` covers every slot column except timestamps, and `template_hash` reduces the ordered slot hashes. The repository selects SQL only through `(template_id,slot_ordinal)` and verifies both SQL hashes before preparing the statement. The hostile-suite authorizer records and compares those fingerprints.

The closed templates and slot sequences are:

| Template                                   | Ordered slots                                                                                                                                                                                         | Total D1 statements |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------: |
| `candidate-item-page-admit-v2`             | component-page guard; item-page insert with accounting postcondition                                                                                                                                  |                   5 |
| `claim-v2`                                 | item update; generation insert                                                                                                                                                                        |                   6 |
| `heartbeat-v2`                             | item update                                                                                                                                                                                           |                   4 |
| `reclaim-retryable-v2`                     | terminal-seal insert; generation update; item/accounting update                                                                                                                                       |                   8 |
| `reclaim-exhausted-v2`                     | terminal-seal insert; generation update; item/accounting update                                                                                                                                       |                   8 |
| `provider-failure-v2`                      | terminal-seal insert; generation update; item/accounting update                                                                                                                                       |                   8 |
| `plan-seal-v2`                             | plan insert; generation CAS                                                                                                                                                                           |                   6 |
| `fact-page-seal-v2`                        | fact-page insert; fact insert; page-seal CAS                                                                                                                                                          |                   8 |
| `terminal-v2`                              | terminal-seal insert; generation update; item/accounting update                                                                                                                                       |                   8 |
| `blocked-allocation-terminal-v2`           | terminal-seal insert; generation update; item/accounting update                                                                                                                                       |                   8 |
| `candidate-accept-v2`                      | live-lease guard; dependency-head guard; fact-seal guard; optional candidate insert; candidate compatibility; success-seal insert; accepted-binding insert; generation update; item/accounting update |                  16 |
| `lifecycle-action-author-first-v2`         | operator guard; action-version insert; action-head insert; event insert; outbox insert                                                                                                                |                  11 |
| `lifecycle-action-author-successor-v2`     | operator guard; action-version insert; action-head CAS; event insert; outbox insert                                                                                                                   |                  11 |
| `lifecycle-revocation-author-first-v2`     | operator guard; revocation-version insert; revocation-head insert; event insert; outbox insert                                                                                                        |                  11 |
| `lifecycle-revocation-author-successor-v2` | operator guard; revocation-version insert; revocation-head CAS; event insert; outbox insert                                                                                                           |                  11 |

Each total includes one context insert, each mutation plus its assertion, assertion-only guard slots, and one receipt. `candidate_insert_optional` alone uses bounds `(0,1)`; its next slot, `candidate_compatibility_select`, requires one byte-identical canonical candidate. Required mutation and guard slots use `(1,1)`. Item postconditions include the exact run-accounting vector after the item transition.

The exact queued/retryable claim is the following six-statement `env.DB.batch()` transaction. Cloudflare D1 executes `batch()` statements sequentially as one transaction and rolls the batch back when a statement fails ([D1 Worker Binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/)).

```sql
INSERT INTO public_projection_core_transaction_contexts (
  transaction_id,template_id,template_hash,
  scope_key_json,scope_key_hash,expected_slot_count,
  next_slot_ordinal,state,created_at
) VALUES (
  :transactionId,'claim-v2',:templateHash,
  :scopeKeyJson,:scopeKeyHash,2,
  0,'open',strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

-- slot 0 mutation
UPDATE public_projection_candidate_items
SET state='processing',
    attempt_count=attempt_count+1,
    lease_owner=:owner,
    lease_token=:token,
    lease_epoch=lease_epoch+1,
    lease_expires_at=strftime(
      '%Y-%m-%dT%H:%M:%fZ','now','+120 seconds'
    ),
    next_generation=next_generation+1,
    last_core_transaction_id=:transactionId,
    last_core_slot_ordinal=0,
    last_core_witness_hash=:itemWitnessHash,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE run_id=:runId AND component_id=:componentId
  AND state IN ('queued','retryable')
  AND attempt_count<max_attempts
  AND lease_owner IS NULL AND lease_token IS NULL
  AND lease_expires_at IS NULL;

-- slot 0 assertion; a missing item mutation inserts zero rows
INSERT INTO public_projection_core_transaction_assertions (
  transaction_id,template_id,assertion_ordinal,operation,target_kind,
  min_rows,max_rows,slot_hash,target_key_hash,witness_hash,
  actual_rows,passed,created_at
)
SELECT
  :transactionId,'claim-v2',0,'claim_item_update','candidate_item',
  1,1,:itemSlotHash,:itemTargetKeyHash,:itemWitnessHash,
  1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM public_projection_candidate_items AS item
JOIN public_projection_candidate_run_accounting AS accounting
  ON accounting.run_id=item.run_id
WHERE item.run_id=:runId AND item.component_id=:componentId
  AND item.component_kind=:componentKind
  AND item.state='processing'
  AND item.attempt_count=:expectedAttemptCount
  AND item.lease_owner=:owner AND item.lease_token=:token
  AND item.lease_epoch=:expectedLeaseEpoch
  AND item.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND item.next_generation=:expectedNextGeneration
  AND item.last_core_transaction_id=:transactionId
  AND item.last_core_slot_ordinal=0
  AND item.last_core_witness_hash=:itemWitnessHash
  AND accounting.total_count=:totalCount
  AND accounting.queued_count=:queuedCount
  AND accounting.processing_count=:processingCount
  AND accounting.retryable_count=:retryableCount
  AND accounting.sealed_count=:sealedCount
  AND accounting.blocked_count=:blockedCount
  AND accounting.failed_count=:failedCount
  AND accounting.superseded_count=:supersededCount;

-- slot 1 mutation
INSERT INTO public_projection_candidate_generations (
  run_id,component_id,generation,component_kind,
  predecessor_generation,state,
  claim_lease_token,claim_lease_epoch,
  created_core_transaction_id,created_core_slot_ordinal,
  created_core_witness_hash,created_at
)
SELECT run_id,component_id,next_generation-1,component_kind,
       CASE WHEN next_generation=2 THEN NULL ELSE next_generation-2 END,
       'processing',lease_token,lease_epoch,
       :transactionId,1,:generationWitnessHash,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM public_projection_candidate_items
WHERE run_id=:runId AND component_id=:componentId
  AND state='processing' AND lease_token=:token
  AND lease_owner=:owner
  AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');

-- slot 1 assertion; an omitted generation mutation inserts zero rows
INSERT INTO public_projection_core_transaction_assertions (
  transaction_id,template_id,assertion_ordinal,operation,target_kind,
  min_rows,max_rows,slot_hash,target_key_hash,witness_hash,
  actual_rows,passed,created_at
)
SELECT
  :transactionId,'claim-v2',1,'claim_generation_insert',
  'candidate_generation',1,1,
  :generationSlotHash,:generationTargetKeyHash,:generationWitnessHash,
  1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM public_projection_candidate_generations AS generation
WHERE generation.run_id=:runId
  AND generation.component_id=:componentId
  AND generation.generation=:claimedGeneration
  AND generation.component_kind=:componentKind
  AND generation.state='processing'
  AND generation.claim_lease_token=:token
  AND generation.claim_lease_epoch=:expectedLeaseEpoch
  AND generation.created_core_transaction_id=:transactionId
  AND generation.created_core_slot_ordinal=1
  AND generation.created_core_witness_hash=:generationWitnessHash;

-- final fail-closed receipt
INSERT INTO public_projection_core_transaction_receipts (
  transaction_id,template_id,template_hash,
  expected_slot_count,actual_assertion_count,passed,created_at
) VALUES (
  :transactionId,'claim-v2',:templateHash,
  2,
  (SELECT COUNT(*)
   FROM public_projection_core_transaction_assertions
   WHERE transaction_id=:transactionId),
  CASE WHEN
    (SELECT state
     FROM public_projection_core_transaction_contexts
     WHERE transaction_id=:transactionId)='open'
    AND
    (SELECT next_slot_ordinal
     FROM public_projection_core_transaction_contexts
     WHERE transaction_id=:transactionId)=2
    AND
    (SELECT COUNT(*)
     FROM public_projection_core_transaction_assertions
     WHERE transaction_id=:transactionId)=2
  THEN 1 END,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
```

The worker reads the inserted generation after commit. Claim increments attempt once, lease epoch once, and next generation once. Generation derives from `next_generation-1`; every retry allocates a fresh generation number.

An expired processing item uses one of two eight-statement reclaim templates. Both insert a context, insert a terminal seal, update the matching processing generation using its stored token and epoch plus `lease_expires_at<=D1 now`, update the item and run accounting, place a mutation-coupled exact-one assertion after each mutation, and finish with a receipt.

- `attempt_count<max_attempts` uses `reclaim-retryable-v2`. The seal and generation become superseded with `lease_expired`; the item becomes retryable, clears every lease column, and preserves attempt and next-generation values. A normal claim may follow in a new transaction.
- `attempt_count=max_attempts` uses `reclaim-exhausted-v2`. The seal, generation, and item become terminal failed state. The seal's primary reason is `retry_budget_exhausted` and its ordered reason set also contains `lease_expired`. The item clears every lease column, preserves its counts, and records `retry_budget_exhausted`.

Both item updates include their branch predicate on `attempt_count` and `max_attempts`; a cross-branch race produces zero assertion rows and the receipt aborts. With `maxAttempts=3`, attempts one and two may return to retryable, while expiry on attempt three is terminal. `HC-49-attempt-boundary` claims attempts one through three, verifies retryable after the first two expiries, verifies failed after the third, and verifies that an attempted fourth claim aborts. The companion N fixture starts at `attempt_count=max_attempts-1` and successfully claims N; the N-plus-1 fixture starts at `attempt_count=max_attempts` and rejects the claim.

Heartbeat is four statements: context, mutation, its mutation-coupled exact-one assertion, and the `heartbeat-v2` receipt.

```sql
UPDATE public_projection_candidate_items
SET lease_expires_at=strftime(
      '%Y-%m-%dT%H:%M:%fZ','now','+120 seconds'
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE run_id=:runId AND component_id=:componentId
  AND state='processing'
  AND lease_owner=:owner AND lease_token=:token AND lease_epoch=:epoch
  AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
```

Every plan, page, seal, terminal, and acceptance mutation repeats that complete live-lease predicate and writes its slot witness. A stale token, epoch, owner, state, or expiry produces zero assertion rows and aborts through the receipt.

A transient provider failure uses the eight-statement `provider-failure-v2` template. It inserts a superseded terminal seal and assertion, updates the processing generation to superseded and asserts, updates the item and accounting and asserts, then writes its receipt. With `attempt_count<max_attempts`, the item becomes `retryable`, clears the lease, and records `transient_provider_failure`. With `attempt_count=max_attempts`, the seal and generation use failed state and `retry_budget_exhausted`, and the item becomes failed. Schema, hash, database, or invariant errors use the eight-statement terminal shape and become failed immediately. Deterministic authority or content conditions become blocked.

Acceptance uses exactly 16 statements under `candidate-accept-v2`: context; three scalar assertion rows for live lease, dependency heads, and sealed facts; candidate `INSERT OR IGNORE` plus its zero-or-one assertion; one scalar exact-one compatibility assertion; success-seal insert plus assertion; accepted-binding insert plus assertion; generation update plus assertion; item/accounting update plus assertion; and the receipt. The compatibility query finds exactly one byte-identical semantic candidate for both candidate-insert outcomes. Retry and acceptance transactions also enforce the bind, SQL, row, bound-value, statement, and write-byte ceilings from Core limits v1.

`HC-48-counted-transaction-counterexamples` runs through real Wrangler local D1 and the real `D1Database.batch()` repository. It proves successful claim, then attempts omitted item mutation, omitted generation mutation, duplicated assertion, reordered slots, substituted operation, stale prior witness, zero-row guard, optional-bound substitution, and missing receipt. Every adversarial batch rolls back to an item in its pre-batch state with zero generation, assertion, context, and receipt rows. The omitted-generation fixture specifically guards against the former ambient-`changes()` failure where the preceding assertion insert made a missing generation appear successful.

## Canonical candidate and per-run binding

Canonical semantic candidates and operational acceptance use separate rows:

```text
public_projection_candidates
  PK candidate_id
  UNIQUE candidate_semantic_hash
  columns:
    candidate_id, candidate_semantic_hash,
    algorithm_bundle_hash, component_hash,
    dependency_digest, root_outcome_digest,
    fact_digest, fact_page_digest,
    created_at

public_projection_candidate_seals
  PK (run_id, component_id, generation)
  columns:
    plan_hash, candidate_id, candidate_semantic_hash,
    dependency_digest, root_outcome_digest,
    fact_count, fact_digest,
    fact_page_count, fact_page_digest,
    seal_hash, sealed_at
  FK (run_id,component_id,generation,plan_hash)
    -> public_projection_candidate_plans(
         run_id,component_id,generation,plan_hash
       )
  FK candidate_id -> public_projection_candidates(candidate_id)

public_projection_candidate_accepted_generations
  PK (run_id, component_id)
  UNIQUE (run_id, component_id, generation)
  columns:
    generation, plan_hash, candidate_id,
    candidate_semantic_hash, seal_hash, accepted_at
  FK (run_id,component_id,generation)
    -> public_projection_candidate_seals(run_id,component_id,generation)
  FK candidate_id -> public_projection_candidates(candidate_id)
```

`candidate_id` in the accepted-generation relation is intentionally non-unique. Several runs may bind to the same canonical candidate when their semantic inputs and outputs match exactly.

```ts
interface CandidateSemanticPayloadV4 {
  contractVersion: 4;
  algorithmBundleHash: string;
  evaluationAt: string;
  evaluationDate: string;
  componentHash: string;
  componentKind: "allocation" | "lifecycle_root";
  allocationHash: string | null;
  rootSetDigest: string;
  rootOutcomeDigest: string;
  dependencyDigest: string;
  effectiveAuthorityHeads: AuthorityHeadRefV1[];
  applicationAuthoritySnapshotPinHash: string | null;
  sourceSelectionDigest: string;
  fieldDecisionDigest: string;
  sourceBindingDigest: string;
  fallbackDigest: string;
  descriptionArtifactDigest: string | null;
  factCount: string;
  factDigest: string;
  factPageCount: string;
  factPageDigest: string;
}
```

`CandidateSemanticPayloadV4.componentKind` accepts the two candidate-producing kinds. The `blocked_allocation` flow stops at its terminal seal.

```text
candidateSemanticHash =
  registeredRecordHash(
    "candidateSemanticHash",
    CandidateSemanticPayloadV4
  )

candidateId =
  registeredIdentifier("candidateId", candidateSemanticHash)

sealHash =
  registeredRecordHash(
    "candidateSealHash",
    {
      candidateId,
      candidateSemanticHash,
      dependencyDigest,
      rootOutcomeDigest,
      factCount,
      factDigest,
      factPageCount,
      factPageDigest
    }
  )
```

The acceptance transaction performs these ordered steps under the exact live lease predicate:

1. Assert the processing item and generation, token, epoch, unexpired D1 lease, plan hash, dependency digest, sealed fact pages, fact reduction, and seal.
1. Insert the canonical candidate with `INSERT OR IGNORE`.
1. Assert that an existing canonical row matches every semantic digest.
1. Insert the run-specific seal.
1. Insert the accepted-generation binding.
1. Change generation and item to sealed and record `accepted_generation`.
1. Assert exact row counts.

This design supports stable candidate identity across runs while preserving one accepted generation per run component.

## Terminal seals and reason ordering

Generation outcomes are exact:

- `blocked` represents a deterministic semantic or authority condition that needs new input or owner action;
- `failed` represents a permanent schema, hash, database, or invariant error;
- `superseded` represents dependency drift, lease loss, or a newer generation; and
- `sealed` represents an accepted private candidate.

Transient network or provider errors move the item to retryable after sealing the processing generation as superseded. Maximum attempts produce failed state.

`CoreReasonCodeV1` is the exhaustive registry below. Schema validation rejects any other reason string. Codes deduplicate and serialize by UTF-8 bytes. `primaryReasonCode` is the member with the lowest category rank, breaking ties by code UTF-8 bytes.

| Category rank | Category                       | Exact reason codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------: | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|            10 | `identity_lifecycle`           | `terminal_root_allocation_conflict`, `merged_root_selected_as_winner`, `root_intent_allocation_conflict`, `d3_allocation_public_identity_ambiguous`, `d3_allocation_public_job_id_collision`, `d3_allocation_component_too_large`, `d3_allocation_state_reason_mismatch`, `lifecycle_idempotency_conflict`, `lifecycle_authority_missing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|            20 | `policy_application_authority` | `decisive_identity_evidence_withheld`, `decisive_identity_evidence_conflict`, `effective_policy_missing`, `effective_label_missing`, `field_policy_withheld`, `field_policy_blocked`, `field_policy_conflict`, `application_authority_snapshot_absent`, `application_authority_snapshot_future_effective`, `application_authority_snapshot_unavailable`, `application_authority_snapshot_stale`, `application_authority_snapshot_expired`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|            30 | `dependency`                   | `dependency_snapshot_missing`, `dependency_hash_mismatch`, `dependency_head_drift`, `legacy_request_requires_v4_successor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|            40 | `content_evidence_privacy`     | `source_origin_ambiguous`, `source_closed`, `source_open_unknown`, `no_allowed_open_assertion`, `minimal_rank_disagreement`, `unsafe_source_url`, `verbatim_overlap_exceeded`, `description_artifact_missing`, `description_artifact_stale`, `description_artifact_rejected`, `terminal_root_missing_public_snapshot`, `new_root_missing_source`, `zero_source_terminal_reuse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|            50 | `bound`                        | `core_limit_request_runs`, `core_limit_request_bytes`, `core_limit_request_boards`, `core_limit_request_listings`, `core_limit_request_public_jobs`, `core_limit_request_root_intents`, `core_limit_request_authorities`, `core_limit_scope_page_entries`, `core_limit_scope_page_bytes`, `core_limit_run_components`, `core_limit_component_roots`, `core_limit_component_bytes`, `core_limit_dependencies`, `core_limit_dependency_member_bytes`, `core_limit_dependency_page_entries`, `core_limit_dependency_page_bytes`, `core_limit_dependency_bytes`, `core_limit_facts`, `core_limit_fact_key_fields`, `core_limit_fact_key_bytes`, `core_limit_fact_evidence_refs`, `core_limit_fact_bytes`, `core_limit_fact_total_bytes`, `core_limit_fact_pages`, `core_limit_fact_page_bytes`, `core_limit_reason_codes`, `core_limit_reason_code_bytes`, `core_limit_artifacts`, `core_limit_artifact_bytes`, `core_limit_statement_binds`, `core_limit_statement_sql_bytes`, `core_limit_transaction_statements`, `core_limit_transaction_bind_bytes`, `core_limit_row_bytes`, `core_limit_transaction_write_bytes`, `core_limit_description_sections`, `core_limit_description_blocks`, `core_limit_description_bullets`, `core_limit_description_evidence_refs`, `core_limit_description_text_bytes`, `core_limit_description_bytes` |
|            60 | `retry`                        | `lease_expired`, `lease_lost`, `transient_provider_failure`, `retry_budget_exhausted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|            70 | `schema_database_invariant`    | `hash_schema_unregistered`, `hash_schema_mismatch`, `schema_invalid`, `fact_schema_invalid`, `database_permanent`, `invariant_violation`, `stale_plan`, `request_scope_listing_missing`, `request_scope_public_job_missing`, `request_scope_not_strict_superset`, `request_migration_mismatch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The migration installs `(reason_code,category_rank,category)` rows under a foreign key used by items, generations, field decisions, outcomes, lifecycle revocations, and terminal seals. The repository validates JSON reason arrays against the same table before hashing.

```text
public_projection_candidate_terminal_seals
  PK (run_id, component_id, generation)
  columns:
    component_kind=allocation|lifecycle_root|blocked_allocation,
    terminal_state=blocked|failed|superseded,
    dependency_digest, root_set_digest,
    primary_reason_code, reason_codes_json,
    artifact_count, artifact_digest,
    claim_lease_token, claim_lease_epoch,
    terminal_seal_hash, terminal_at
  FK (run_id,component_id,generation,component_kind)
    -> public_projection_candidate_generations(
         run_id,component_id,generation,component_kind
       )
```

`TerminalArtifactKindV1` is exactly `plan`, `dependency_page`, `field_decision`, `source_selection`, `description_artifact`, `root_outcome`, `fact_page`, or `diagnostic`, with ranks 0 through 7 in that listed order. For each retained artifact:

```text
leaf = registeredRecordHash(
  "terminalArtifactLeafHash",
  {artifactKind, artifactKey, artifactHash}
)

artifactDigest = registeredReductionHash(
  "terminalArtifactDigest",
  leaves ordered by artifact-kind rank then artifact-key UTF-8 bytes
)
```

`artifact_count` equals the leaf count. A terminal containing zero retained artifacts uses the registered empty reduction rather than a null digest. Artifact keys use semantic coordinates only: plan hash; dependency-page ordinal; field-decision natural key; public-job ID for selection, description, and outcome; fact-page ordinal; or diagnostic code plus ordinal. Run ID, component row ID, lease owner, lease token, transaction ID, and timestamps stay outside artifact keys and semantic hashes.

```text
terminalSealHash =
  registeredRecordHash(
    "candidateTerminalSealHash",
    {
      generation,
      componentKind,
      terminalState,
      dependencyDigest,
      rootSetDigest,
      primaryReasonCode,
      sortedReasonCodes,
      artifactCount,
      artifactDigest
    }
  )
```

The terminal transaction is seven statements: seal insert and assertion, generation CAS and assertion, item CAS and assertion, then the `terminal-v2` receipt. Both CAS updates require processing state, the current token and epoch, and an unexpired D1 lease. Run ID, component ID, token, epoch, and terminal time bind operationally through the row key and transaction while semantic terminal hashing stays deterministic. Terminal seal, generation, and reason rows reject update/delete.

## Shadow-only storage invariant

Candidate-worker may mutate these families:

- `public_projection_requests`, scope pages and members, expansions, candidate components and roots, and candidate run accounting;
- candidate items, generations, dependencies, field decisions, facts, pages, candidates, accepted bindings, success seals, and terminal seals; and
- counted transaction contexts, assertions, and receipts reached through a registered candidate template.

Source-position version authority alone may mutate the exact `job_source_position_*` version, child, and head relations assigned to its four writer classes. Lifecycle authority alone may mutate lifecycle action and revocation versions, their heads, causal events, and outbox rows. Each authority reaches counted relations only through one of its registered templates.

Candidate-worker leaves source-position versions and heads plus live entity, mapping, content, route, alias, destination, contact, attempt, employer-authority, catalog, search, sitemap, and `JobPosting` relations unchanged. The acceptance suite runs three database authorizers:

1. candidate-worker rejects every source-position, lifecycle, and live-family write;
1. source-position version authority rejects every candidate, lifecycle, and live-family write and admits only the selected writer-class family; and
1. lifecycle authority rejects every candidate, source-position, and live-family write.

The migration-backfill authorizer further limits source-position writes to version/head, persistent staging, registry, and migration-guard relations. `HC-58-writer-authority-separation` attempts each cross-family write through every identity and requires authorization failure plus byte-identical before-and-after digests for the protected families.

## Exact hostile acceptance suite

The independent verifier runs these fixtures against the real migration chain and core repository:

| Fixture                                     | Setup                                                                                                                                                                             | Required result                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HC-01-repeat-cross-run`                    | One sealed request key, two distinct run nonces/IDs, identical semantic dependencies and outputs                                                                                  | Same component ID, plan hash, candidate ID, semantic hash, and seal hash; two accepted bindings; run ID stays outside semantic hashes                                               |
| `HC-02-repeat-generation`                   | Retry generation with identical plan and facts                                                                                                                                    | Same candidate ID; one accepted generation for the component; prior superseded generation immutable                                                                                 |
| `HC-03-plan-before-facts`                   | Attempt fact insert before a registered plan                                                                                                                                      | Foreign-key or repository rejection; zero fact rows                                                                                                                                 |
| `HC-04-child-key`                           | Reuse fact ordinal under another generation                                                                                                                                       | Independent row under generation key; zero collision                                                                                                                                |
| `HC-05-stale-token`                         | Seal with a former lease token                                                                                                                                                    | Zero updated rows; generation remains processing or superseded by the valid claimer                                                                                                 |
| `HC-06-stale-epoch`                         | Seal with current token and former epoch                                                                                                                                          | Zero updated rows                                                                                                                                                                   |
| `HC-07-expired-lease`                       | Seal after D1 server-clock expiry                                                                                                                                                 | Zero updated rows                                                                                                                                                                   |
| `HC-08-sealed-immutability`                 | Update a sealed fact page, generation, seal, or binding                                                                                                                           | Authorizer or trigger rejection                                                                                                                                                     |
| `HC-09-dependency-drift`                    | Advance one dependency after the first closure read                                                                                                                               | Superseded terminal seal and retryable item                                                                                                                                         |
| `HC-10-hash-registry-missing`               | Remove one required core registry row                                                                                                                                             | Blocked `hash_schema_unregistered` before staging                                                                                                                                   |
| `HC-11-hash-schema-drift`                   | Change one schema-definition hash                                                                                                                                                 | Blocked `hash_schema_mismatch`                                                                                                                                                      |
| `HC-12-decimal-large`                       | `9007199254740993.125` as JSON string                                                                                                                                             | Exact canonical text and stable fact hash across runtimes                                                                                                                           |
| `HC-13-decimal-number`                      | Same value as a JSON number                                                                                                                                                       | Boundary validation failure                                                                                                                                                         |
| `HC-14-decimal-negative-zero`               | `-0`, `-0.0`, and `0e9`                                                                                                                                                           | Boundary rejection; canonical producer emits `0`                                                                                                                                    |
| `HC-15-unicode`                             | Non-ASCII scalar values and an unpaired surrogate                                                                                                                                 | Valid scalars hash by exact UTF-8; surrogate fails validation                                                                                                                       |
| `HC-16-extra-field`                         | Add one undeclared semantic field                                                                                                                                                 | Schema validation failure before hashing                                                                                                                                            |
| `HC-17-d3-policy-independent`               | Strong decisive evidence is policy-withheld and weak evidence is allowed                                                                                                          | D3 identity stays fixed; root becomes private with `decisive_identity_evidence_withheld`                                                                                            |
| `HC-18-authority-absent`                    | Null application-authority reference                                                                                                                                              | Sealed private root with `application_authority_snapshot_absent`                                                                                                                    |
| `HC-19-authority-stale`                     | Snapshot state stale or expiry at evaluation time                                                                                                                                 | Sealed private root with exact stale or expired reason                                                                                                                              |
| `HC-20-authority-opaque`                    | Change a private route field while retaining snapshot ID and hash                                                                                                                 | Core receives identical input because its read surface contains the opaque reference fields                                                                                         |
| `HC-21-zero-source-terminal`                | Existing suppressed root, valid predecessor snapshots, zero mappings                                                                                                              | Sealed suppressed outcome with reused content                                                                                                                                       |
| `HC-22-zero-source-new`                     | New root and zero mappings                                                                                                                                                        | Blocked `new_root_missing_source`                                                                                                                                                   |
| `HC-23-lifecycle-conflict`                  | D3 loser plus explicit published intent                                                                                                                                           | Blocked `root_intent_allocation_conflict`                                                                                                                                           |
| `HC-24-revoked-action`                      | Current action has an effective revocation                                                                                                                                        | Action excluded; preserved or private outcome with authority reason                                                                                                                 |
| `HC-25-position-leak`                       | Sibling-position evidence appears in selected position                                                                                                                            | Evidence disposition prevents selection; sentinel absent from candidate facts                                                                                                       |
| `HC-26-page-order`                          | Same facts inserted in different worker batches                                                                                                                                   | Same sorted fact digest, page plan, candidate ID, and seal                                                                                                                          |
| `HC-27-shadow-authorizer`                   | Core attempts one live table write                                                                                                                                                | Transaction rejected; all live-row counts and hashes unchanged                                                                                                                      |
| `HC-28-no-catalog-link`                     | Inspect core foreign keys and staged values                                                                                                                                       | Zero catalog foreign keys and zero catalog IDs in fact schemas                                                                                                                      |
| `HC-29-policy-effective-only`               | Add a pending policy while effective head stays fixed                                                                                                                             | Byte-identical request, plan, candidate facts, candidate ID, and seal                                                                                                               |
| `HC-30-terminal-determinism`                | One sealed request key, two run IDs, matching generation number, terminal state, dependencies, roots, reasons, and artifacts                                                      | Matching terminal seal hash; two operational terminal rows; run identity stays outside terminal hashing                                                                             |
| `HC-31-authority-future`                    | Authority snapshot effective one millisecond after evaluation                                                                                                                     | Sealed private root with `application_authority_snapshot_future_effective`; predecessor authority stays untouched                                                                   |
| `HC-32-plan-parent-and-page-zero`           | Insert fact without plan; then seal page zero with another predecessor                                                                                                            | Composite FK rejects the fact; page-zero hash check rejects the page; zero accepted rows                                                                                            |
| `HC-33-natural-key-duplicate`               | Two facts share kind and exact natural key but have distinct fact hashes                                                                                                          | Unique natural-key constraint rejects the second fact                                                                                                                               |
| `HC-34-label-version-hash`                  | Verify backfill, advance label head before acceptance, then repeat after accepted sealing                                                                                         | Hash matches canonical derivation; pre-acceptance advance supersedes; post-seal candidate remains byte-identical and promotion sees head drift                                      |
| `HC-35-source-open-version`                 | Change inventory status and source-open head before acceptance, then repeat after accepted sealing                                                                                | Pre-acceptance change supersedes; post-seal candidate remains immutable; a later request sees successor open head                                                                   |
| `HC-36-lifecycle-effective-time`            | Future-effective head with an unexpired predecessor, plus later effective revocation                                                                                              | Evaluation selects predecessor before head effective time and excludes it after effective revocation                                                                                |
| `HC-37-source-rank-boundaries`              | One fixture for every adjacent origin, position, provenance, prior-source, and ID tie-break                                                                                       | Exact expected winner for each pair; shuffled input produces same selection                                                                                                         |
| `HC-38-source-origin-ambiguous`             | Conflicting origin predicates with pinned evidence                                                                                                                                | Private root with `source_origin_ambiguous`; ranking input contains only resolved origin classes                                                                                    |
| `HC-39-fallback-minimal-prefix`             | Equal minimal rank prefix with matching and conflicting typed values                                                                                                              | Matching hashes select deterministically; differing hashes produce `minimal_rank_disagreement`                                                                                      |
| `HC-40-description-canonical`               | Equivalent section data with CRLF, reordered object keys, and evidence ordinal input order                                                                                        | One canonical JSON byte sequence and sections hash; N/N+1 description fixtures enforce each bound                                                                                   |
| `HC-41-zero-source-reused-fact`             | Existing suppressed root with predecessor content and zero source positions                                                                                                       | One `reused_content` fact pins predecessor version and hashes and participates in fact digest                                                                                       |
| `HC-42-request-expansion`                   | Same-scope request, strict-superset request, removed-member request, and changed predecessor intent                                                                               | Same scope reuses request; strict superset writes one edge; removal or intent mutation yields `request_scope_not_strict_superset`                                                   |
| `HC-43-request-run-cardinality`             | Insert 16 distinct run nonces, then a seventeenth for one request                                                                                                                 | First 16 succeed; seventeenth writes zero rows with `core_limit_request_runs`                                                                                                       |
| `HC-44-lease-retry-exhaustion`              | Three transient attempts plus stale token, stale epoch, expiry, and heartbeat boundary cases                                                                                      | Attempts and generations are 1, 2, and 3; the final state and reason are failed and `retry_budget_exhausted`                                                                        |
| `HC-45-lifecycle-authoring`                 | Member author, operator author, idempotent replay, conflicting replay, stale predecessor, and effective-time chain                                                                | Member and stale-predecessor writes affect zero rows; operator succeeds; replay is stable; conflict uses `lifecycle_idempotency_conflict`; effective action follows evaluation time |
| `HC-46-migration-0049-rebuild`              | Seed every 0049 status/counter shape and rebuild relations                                                                                                                        | Counts, IDs, counters, errors, timestamps, and dependent foreign keys match; legacy requests remain audit-readable and v4-ineligible                                                |
| `HC-47-registry-executability`              | Load each registry row alone, reject reference tokens, and generate codecs, comparators, empty reductions, and identifiers                                                        | Every row generates from its inlined graph plus the fixed meta-codec; cross-runtime raw and hex hashes match                                                                        |
| `HC-48-counted-transaction-counterexamples` | Run successful claim plus omitted mutation, duplicate, reorder, substitution, stale-witness, bound, guard, and receipt attacks through Wrangler local D1 and `D1Database.batch()` | Every attack rolls back item, accounting, generation, context, assertion, and receipt state; successful claim creates one witnessed generation                                      |
| `HC-49-attempt-boundary`                    | Expire attempts one, two, and three, then request a fourth claim                                                                                                                  | First two return retryable; third becomes failed with `retry_budget_exhausted`; fourth changes zero rows and aborts                                                                 |
| `HC-50-source-open-chain`                   | Apply migrations 0001 through 0057, backfill open versions from current names, and advance one head                                                                               | One version/head per source position, exact `job_listings` values and hashes, zero foreign-key violations, and deterministic drift behavior                                         |
| `HC-51-dependency-materialization`          | Materialize one row of every dependency kind from its normative source map                                                                                                        | Every member resolves to one immutable physical row and exact hash; synthetic or missing versions fail                                                                              |
| `HC-52-evidence-entry-reduction`            | Persist two claims with stable claim hashes, then change offsets or disposition in one entry                                                                                      | Stored entry hashes reproduce the set digest; changed entry metadata changes its entry hash and set digest                                                                          |
| `HC-53-canonical-json-all-families`         | Serialize every JSON family in TypeScript, Go, Rust, and SQLite fixtures, including duplicate keys and JSON numbers                                                               | Cross-runtime bytes and hashes match the four vectors; duplicate keys, numbers, surrogates, and extra fields fail                                                                   |
| `HC-54-blocked-d3-allocation`               | Feed each migration-0057 blocked reason plus one invalid state/reason pair                                                                                                        | Exact blocked terminal reason with sealed 0057 dependencies and zero plans/facts/candidates; invalid pair fails                                                                     |
| `HC-55-lifecycle-event-outbox`              | Author and revoke with replay, conflict, stale head, and concurrent idempotency races                                                                                             | Exact event ID/hash/payload and one outbox row per accepted version; replay writes zero rows; conflicts and stale heads abort                                                       |
| `HC-56-run-replacement-compatibility`       | Seed every migration-0049 run field and direct dependent family, execute replacement, then run Worker reads and updates                                                           | All 28 legacy columns are value-identical, nonce is deterministic, foreign-key check is empty, reads and updates pass, and old create semantics are rejected                        |
| `HC-57-request-scope-algebra`               | Execute every empty/nonempty selector combination, intersection, duplicate, inactive, unknown-board, missing-ID, zero-source, and overlapping-root case                           | Cohort and component IDs match the declared intersection-plus-union algebra; missing IDs abort sealing with exact codes                                                             |
| `HC-58-writer-authority-separation`         | Attempt candidate, source-version, lifecycle, and live writes through each writer identity                                                                                        | Only the owning allowlist and registered SQL fingerprints succeed; protected-family digests remain byte-identical                                                                   |
| `HC-59-lifecycle-head-semantics`            | Insert first head, advance by CAS, attempt stale and arbitrary updates, test absent action/revocation heads, then create a head after request sealing                             | First and successor writes succeed; stale, direct, and delete writes abort; absence delegates to predecessor/request intent; later head creation supersedes                         |
| `HC-60-description-visible-renderer`        | Render both golden descriptions in TypeScript, Go, Rust, and SQLite and run overlap checks at exact offsets                                                                       | Visible bytes, raw SHA-256, registered `outputTextHash`, final LF, and normalized half-open code-point offsets match                                                                |
| `HC-61-blocked-allocation-accounting`       | Materialize each real migration-0057 blocked component and process a one-component run                                                                                            | Kind propagates component -> item -> generation -> terminal; zero semantic candidate rows; accounting is exactly total 1 and blocked 1                                              |
| `HC-62-d1-rebuild-executability`            | Apply migrations 0001 through 0057 plus the exact 0049 rebuild with Wrangler local D1                                                                                             | D1 accepts the migration; both guards pass; original runs survive; foreign-key check is empty; FK/defer/legacy pragmas finish at 1/0/0                                              |

The verification packet records schema SQL, query plans for claims and accepted bindings, transaction row counts, fact and page reductions, canonical decimal vectors, cross-runtime hash vectors, database-authorizer logs, and live-table before-and-after digests.

## Implementation order

1. Install strict semantic codecs and the complete core hash registry.
1. Add immutable requests, components, dependency closure, and lifecycle authority.
1. Add the separate source-position version-authority writers, analysis, evidence, field decisions, and authored descriptions.
1. Add candidate items, generations, D1-time leases, facts, and fact pages.
1. Add canonical candidates, per-run accepted bindings, and terminal seals.
1. Run the exact hostile suite and independent core audit.
1. Hand accepted candidate facts to the downstream authority, catalog, and promotion modules.
