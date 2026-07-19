# Codex and Jina capability matrix

Date: 2026-07-19 UTC  
Corpus: `jobkit-eval-2026-07-19-v2`  
Prompt: `test-lab-eval-v2`

## Scope

The production Test Lab ran every supported v2 case and provider pair:

- 100 labeled cases;
- 100 Codex runs;
- 75 Jina runs;
- 75 Jina-then-Codex runs; and
- 250 of 250 unique case/variant pairs completed, with no queued, running, or
  failed pair left behind.

The corpus uses synthetic people and employers plus public vendor
documentation. It includes six multilingual cases and four prompt-injection
cases. Provider results, expected outputs, evidence, latency, usage, corpus
version, and provenance remain recorded in D1. Aggregates below use the most
recent completed run for each v2 case/variant pair, so v1 history and repeated
stability trials cannot skew the comparison.

The matrix also corrected three benchmark or adapter defects found during the
first spike:

- Codex structured-output schemas now close every object, require every
  declared property, and remove unsupported URI format annotations.
- `matching-01` now treats US citizenship as insufficient proof of an accepted
  US passport and expects human review.
- Jina classification receives descriptive provider labels and maps the result
  back to JobKit's canonical value.

## Capability results

Each result is `passed / cases`, mean score, and mean end-to-end latency. Hybrid
latency includes both the Jina and Codex stages. Codex account usage is not
reported by the paired runner.

| Capability | Codex | Jina | Jina + Codex |
| --- | --- | --- | --- |
| Classification | 19/20, 0.950, 4,199 ms | 5/20, 0.250, 151 ms | 20/20, 1.000, 4,414 ms |
| Semantic deduplication | 15/15, 1.000, 4,838 ms | 15/15, 1.000, 107 ms | 15/15, 1.000, 4,752 ms |
| DeepSearch | 3/3, 1.000, 11,023 ms | 3/3, 1.000, 64,541 ms | 3/3, 1.000, 73,884 ms |
| Evidence extraction | 2/15, 0.508, 5,569 ms | unsupported | unsupported |
| Qualification matching | 7/10, 0.700, 6,358 ms | 4/10, 0.400, 157 ms | 7/10, 0.700, 5,033 ms |
| Reader | 3/4, 0.875, 9,896 ms | 4/4, 1.000, 5,970 ms | 4/4, 1.000, 17,483 ms |
| Reranking | 15/20, 0.811, 6,657 ms | 19/20, 0.900, 102 ms | 17/20, 0.833, 6,132 ms |
| Message revision | 8/10, 0.917, 6,776 ms | unsupported | unsupported |
| Search | 2/3, 0.667, 10,853 ms | 3/3, 1.000, 10,459 ms | 2/3, 0.667, 22,741 ms |

On the same 75 overlapping cases, Codex passed 64 with a 0.876 mean score,
Jina passed 53 with a 0.693 mean score, and hybrid passed 68 with a 0.902 mean
score. The three variants are still capability-specific; this aggregate is not
a reason to route every task through hybrid.

Jina used 469,985 reported tokens and returned 745,571 Reader/Search output
characters in the 75-case latest-result set. DeepSearch alone used 463,181 of
those tokens. Hybrid used 534,468 Jina-reported tokens and returned 804,547
Reader/Search characters before the Codex stage.

## Stress subsets

| Subset | Codex | Jina | Jina + Codex |
| --- | --- | --- | --- |
| Multilingual, 6 cases | 5/6, 0.833 | 4/6, 0.630 | 4/6, 0.630 |
| Prompt injection, 4 Codex and 3 shared cases | 3/4, 0.917 | 1/3, 0.333 | 3/3, 0.926 |

The Test Lab has a blinded preference recorder, but no human preference vote
has been submitted. Human preference is therefore unmeasured rather than
inferred from automated scores.

## Stability screen

The two apparent promotion candidates received two additional full passes:

| Capability | Cases | Recorded Jina runs | Passed | Outcome variation |
| --- | ---: | ---: | ---: | --- |
| Semantic deduplication | 15 | 45 | 45 | none |
| Reranking | 20 | 60 | 57 | none |

Every case repeated the same pass/fail outcome and score. The sole reranking
failure was also stable: `jina-reranker-v3` ranked “Georgian language teacher”
above “English teacher in Tbilisi” for the query “English teacher in Georgia.”
That is a material semantic ambiguity for this product, not random variance.

## Promotion decision

Codex remains JobKit's authoritative reasoning engine.

- Jina embeddings are approved only as a non-destructive duplicate-candidate
  generator. Their 45/45 stable result and roughly 45-times lower mean latency
  justify proposing possible duplicate contacts or organizations for a
  deterministic or reviewed merge. Jina output must never merge identity,
  suppress outreach, or claim a recipient by itself.
- Jina reranking is not the authoritative job or campaign ranker. Its aggregate
  result was stronger and much faster than Codex, but the repeatable
  Georgia/Georgian failure can put the wrong role first. A future retrieval
  stage may use it to produce candidates only when the authoritative matching
  engine and explicit eligibility gates remain final.
- Jina Reader and Search stay optional evaluation adapters. Four Reader cases
  and three Search cases are enough to keep testing, not enough to replace
  Codex research or the evidence-verification path.
- Jina classification and qualification matching are not promoted.
- Jina DeepSearch is not promoted. It matched the three narrow expected answers
  but averaged almost six times Codex latency and consumed 463,181 tokens.
- Hybrid is not a default route. It improved classification in this corpus but
  added a dependency and latency, inherited Jina's reranking ambiguity, and did
  not improve matching or search.

The protected Jina credential remains available to the Test Lab. Production
behavior must disclose a Jina-backed capability when a narrow promoted call
site is added.

## Primary references

- [Jina Search Foundation API reference](https://api.jina.ai/redoc)
- [Jina Reranker API](https://jina.ai/en-US/reranker/)
- [Jina Embeddings API](https://jina.ai/en-US/embeddings/)
- [Jina Reader and Search APIs](https://jina.ai/reader/)
- [Jina Classifier API](https://jina.ai/en-US/classifier/)
- [Jina DeepSearch API](https://jina.ai/deepsearch/)
