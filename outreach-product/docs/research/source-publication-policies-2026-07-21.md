# Source publication policy audit

Audit date: 2026-07-21

**Contract amendment:** `source-publication-policy-activation-v2`, 2026-07-22

This audit controls public reuse of JobKit's private source inventory. Collection, candidate matching, identity resolution, and application routing remain separate private operations. Every policy begins with public publication disabled. A later approval appends a new pending policy version with its own evidence.

The v2 amendment adopts the effective-head, pending-head, catalog-temporal-snapshot, source-global activation, and emergency-revocation rules from the [catalog and temporal authority contract](public-catalog-temporal-contract-2026-07-22.md). The [candidate core](public-projection-candidate-core-contract-2026-07-22.md) evaluates current effective policies only. These module authorities supersede the earlier immediate-removal language in this audit.

## Decisions

### Ajarn decision

Initial decision: **rejected and blocked**. The official terms reserve site content, and the current homepage asks other sites to stop copying ads. Written permission provides the publication path.

### ANESL decision

Initial decision: **rejected and blocked**. The official workflow acts as an application intermediary and accepts a bundle of up to five school IDs. The reviewed site provides no republication grant.

### ESL Cafe decision

Initial decision: **pending and metadata only**. Robots policy permits crawling. The official terms provide no third-party republication license. An explicit review can authorize a bounded metadata subset.

### SeriousTeachers decision

Initial decision: **pending and metadata only**. Robots policy permits links and short excerpts while restricting AI summaries. The official terms provide no third-party publication license. An explicit review can authorize a bounded metadata subset.

### TEFL.com decision

Initial decision: **rejected and blocked**. The official terms limit use and application behavior. A feed agreement or written automation and reuse permission provides the publication path.

Pending and rejected policies both remain disabled. The distinction records the next review action without changing the public result.

## Evidence

### Ajarn

- [Homepage](https://www.ajarn.com/)
- [Terms of use](https://www.ajarn.com/terms-of-use)
- [Robots policy](https://www.ajarn.com/robots.txt)

### ANESL

- [Application process](https://www.anesl.com/schools/application.asp)
- [Program information](https://www.anesl.com/schools/program.asp)
- [Frequently asked questions](https://www.anesl.com/schools/faq.asp)
- [Contact page](https://www.anesl.com/schools/contackus.asp)
- `https://cafe.anesl.com/robots.txt` returned HTTP 404 during review.

### ESL Cafe

- [Terms](https://www.eslcafe.com/terms)
- [Privacy policy](https://www.eslcafe.com/privacy)
- [Robots policy](https://www.eslcafe.com/robots.txt)

### SeriousTeachers

- [Terms of use](https://www.seriousteachers.com/shared/terms_use)
- [Privacy policy](https://www.seriousteachers.com/shared/privacy)
- [Robots policy](https://www.seriousteachers.com/robots.txt)

### TEFL.com

- [Terms and conditions](https://www.tefl.com/about-us/terms-and-conditions.html)
- [Privacy policy](https://www.tefl.com/about-us/privacy.html)
- `https://www.tefl.com/robots.txt` returned HTTP 404 during review.

## Enforcement contract

Public projection requires every contributing source policy to satisfy all of these conditions:

1. The decision snapshots the current effective policy head.
1. The policy approval state is `approved`.
1. Publication is enabled.
1. The scope is broader than `blocked`.
1. Every projected field appears in the policy allowlist.
1. Every source mapping and listing material version remains current.

The initial migration seeds five disabled effective policy heads and zero public jobs. Approval, correction, and rollback append immutable policy versions and advance only `source_publication_policy_pending_heads`. Ordinary authoring leaves the effective head, active catalog, public queries, cursors, ETags, sitemap, and `JobPosting` output unchanged.

### Effective evaluation and selected activation targets

Candidate requests and candidate facts pin the sorted effective source-policy versions and hashes used for evaluation. They contain zero pending activation targets.

Source-global manifests contain two explicit sorted sets:

- `expectedEffectiveAuthorityTargets`, whose source-policy members pin every effective source-policy version and hash used to build the successor; and
- `selectedPendingAuthorityTargets`, whose source-policy members name each pending source-policy version and hash authorized for activation.

The selected set defaults to empty. Main allocation and lifecycle promotion assert empty source-policy and source-label selections. A source-global selected target equals the current pending head and names the expected effective predecessor. Stale, duplicated, or extra targets fail the source-global transaction.

### Source-global activation

A source-policy change can affect every public root that depends on the source. The reverse-dependency closure is exhaustive: it starts from all current and historical source-position mappings for the source; follows redirect roots, winner and loser allocation edges, public content and decision bindings, route aliases, catalog membership, search documents, location facets, and `JobPosting` authority; and returns the byte-sorted unique terminal public-root IDs plus every retained alias root that can change HTTP behavior.

The catalog and temporal authority contract defines the source-global manifest, pages, seal, lease, and counted transaction. Its immutable plan pins the source key, expected effective and selected pending target, reverse-dependency algorithm version, affected-root count, page count, page hashes, affected-root reduction hash, predecessor catalog temporal snapshot, successor catalog hashes, promotion-limits evidence version and hash, and replay key.

The exact admitted affected-root upper bound is `promotionLimits.maxSourceGlobalAffectedRoots` from the current remote-D1 promotion-limits evidence artifact. Each plan page uses that artifact's `maxSourceGlobalRootsPerPage`, `maxPageBytes`, and operation bounds. A plan above the admitted root count becomes `quarantined_oversize` before effective-head activation. It writes no effective policy head and exposes no partially changed catalog. An operator may then execute the separately authorized emergency-revocation path, reduce the source dependency graph, or publish a successor limits artifact backed by a new remote benchmark.

### Emergency revocation

The catalog and temporal authority contract defines emergency revocation as an executable manifest and batch. This audit supplies the source decision and blocked successor policy; the module owns affected-root closure, filtered or quarantine catalog, limits evidence, transaction ordering, replay, events, and cutover.

Scheduled policy expiry uses the catalog contract's leased event mechanism. Its cutover advances effective authority and the exact catalog temporal snapshot atomically. Public executors enforce wall-clock expiry as a fail-closed backstop and require a successor logical snapshot when output changes.

### Identity boundary

The identity and location contract resolves D3 organization and location from complete policy-independent evidence. Candidate core checks the current effective policy for every decisive evidence source. A disallowed decisive source yields a private outcome while preserving the sealed identity.
