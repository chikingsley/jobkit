# Codex and Jina capability matrix

Date: 2026-07-19 UTC\
Corpus: `jobkit-eval-2026-07-19-v2`\
Prompt: `test-lab-eval-v2`

## Classification correction

The classification and hybrid rows below are historical results; routing decisions require the corrected rerun. The original Jina adapter used `jina-embeddings-v5-text-small`, and the hybrid path also changed the Codex baseline from Luna with medium reasoning to Terra with high reasoning. That made the hybrid comparison confounded: it measured a stronger Codex configuration as well as the Jina intermediate.

The Test Lab adapter now uses `jina-embeddings-v3` for zero-shot classification while retaining `jina-embeddings-v5-text-small` for the separate embedding-based duplicate-candidate task. Classification-only Codex and Jina-plus-Codex runs now use the same Luna model and medium reasoning configuration.

A controlled direct rerun executed the actual Jina Worker adapter three times across all 20 classification cases. Every pass scored 13/20. The aggregate was 39/60 correct, 0.650 accuracy, and 0.624 macro-F1. English-teaching recall was 1.000, subject-teaching recall was 0.600, non-teaching recall was 0.200, and unclear recall was 0.800. Scores ranged from 0.251 to 0.277, too close to a four-class uniform distribution to support confidence-based production routing. Median request latency across the three passes ranged from 276 to 352 milliseconds; pass-level p95 latency ranged from 499 to 1,188 milliseconds.

The canonical experiment CLI also ran a controlled four-model screen with all 20 inputs in one request per model. Batch timing is end-to-end provider latency for the complete 20-case batch, and this single pass measures model differences rather than stability:

| Model                           | Correct | Accuracy | Macro-F1 | Batch time |
| ------------------------------- | ------: | -------: | -------: | ---------: |
| `jina-embeddings-v3`            |   13/20 |    0.650 |    0.624 |     565 ms |
| `jina-embeddings-v4`            |   12/20 |    0.600 |    0.558 |     406 ms |
| `jina-embeddings-v5-text-small` |    5/20 |    0.250 |    0.151 |     267 ms |
| `jina-embeddings-v5-text-nano`  |    7/20 |    0.350 |    0.332 |     242 ms |

v4 classified every subject-teaching case correctly but recalled only one of five unclear cases. v5 text small collapsed the subject-teaching and unclear classes completely, while v5 text nano missed every English-teaching case. The matrix therefore keeps v3 as the zero-shot baseline and gives the real-corpus private-classifier experiment a concrete target to beat.

The request contract was checked against Jina's current OpenAPI schema and official MCP implementation. `/v1/classify` explicitly supports v3, v4, v5 text small, and v5 text nano; the request shape is the documented `model`, `input`, and `labels` body. A three-repeat label-wording control then compared the existing descriptive labels with concise natural-language labels and canonical identifiers:

| Model                           | Descriptive | Concise | Canonical |
| ------------------------------- | ----------: | ------: | --------: |
| `jina-embeddings-v3`            |       0.650 |   0.483 |     0.450 |
| `jina-embeddings-v4`            |       0.600 |   0.500 |     0.500 |
| `jina-embeddings-v5-text-small` |       0.250 |   0.183 |     0.283 |
| `jina-embeddings-v5-text-nano`  |       0.350 |   0.200 |     0.300 |

Values are aggregate accuracy over 60 observations per cell. Ten of the twelve cells returned identical predictions on all three repeats; the remaining two changed one case. The v5 deficit is reproducible across all three label phrasings, which excludes verbose labels as the cause. Jina's published v5 benchmark claims concern broad embedding classification tasks; JobKit's four-way taxonomy requires its own evaluation.

## Real-listing corpus

Phase one has a retained SQLite annotation ledger with 200 active listings: 40 each from Ajarn, ANESL, ESL Cafe, Serious Teachers, and TEFL, spanning 99 countries. Exact normalized-content hashes are unique within the sample. Two isolated `gpt-5.6-sol` Codex passes used medium reasoning, the same versioned taxonomy prompt, opposite item order, and no access to the other pass.

- 177 listings received the same label in both passes.
- The operator adjudicated all 23 disagreements.
- One agreed Guatemala listing retained `unclear` with explicit low-confidence-agreement provenance.
- Source text, source hashes, both labels, evidence, rationales, prompt version, model, reasoning effort, and timestamps remain in the ignored local ledger.

The freeze produced 200 final labels: 176 ordinary model agreements, one low-confidence model agreement, and 23 operator adjudications. A deterministic leakage pass formed 153 groups, including 15 multi-listing groups and a 26-listing ANESL university template family. The group-level split contains 174 training listings and 26 held-out listings. No exact company or detected high-overlap template group crosses that boundary.

The held-out zero-shot v3 baseline scored 14/26 correct, 0.538 accuracy, and 0.324 macro-F1 in 700 milliseconds. English-teaching F1 was 0.733; subject-teaching F1 was 0.200; unclear F1 was 0.364; and the sole non-teaching example was missed. This is below production quality.

Private training could not be evaluated because Jina's `/v1/train` returned HTTP 500 for the complete 174-listing private request and for schema-minimal diagnostics. A model-control pass on July 20 used the same four synthetic text examples with explicit private access and the live OpenAPI request shape. V3, v4, v5 text small, and v5 text nano all returned `INTERNAL_ERROR`; their provider request IDs were `1c3376ca4bb768f5ad7ae2b4b4371e8b`, `24b95274bf750e77ad7ae2b4b4371a97`, `0e15406f46a09549ad7ae2b4b4371e67`, and `9e20967a85c89431ad7ae2b4b4371c4d`. A synthetic v5 text small public-access control also returned HTTP 500 with request ID `7d111c5bd0b274282e3e82ff2f2e997f`. The failure therefore affects hosted training for this credential rather than private access or one model generation. Zero-shot `/v1/classify` continues to return HTTP 200 with the same credential.

The current OpenAPI schema accepts all four tested models for `/v1/train`. Jina's current model catalog explicitly lists `train` for v3 and does not mark it deprecated. The public classifier documentation advertises v3, v4, and CLIP for few-shot use; no official incident or Jina GitHub issue explains the repeated provider error, and the status page reports all monitored systems operational. The retained command now accepts `--model` so the frozen corpus can be retried without another ad hoc script.

The real-corpus result confirms that synthetic-case accuracy overstated zero-shot v3 quality. Classification remains a Test Lab capability, and low-confidence or ambiguous decisions remain Codex or human-review work until the private classifier can be trained and beats the frozen held-out baseline.

## Scope

The production Test Lab ran every supported v2 case and provider pair:

- 100 labeled cases;
- 100 Codex runs;
- 75 Jina runs;
- 75 Jina-then-Codex runs; and
- 250 of 250 unique case/variant pairs completed, with no queued, running, or failed pair left behind.

The corpus uses synthetic people and employers plus public vendor documentation. It includes six multilingual cases and four prompt-injection cases. Provider results, expected outputs, evidence, latency, usage, corpus version, and provenance remain recorded in D1. Aggregates below use the most recent completed run for each v2 case/variant pair, so v1 history and repeated stability trials cannot skew the comparison.

The matrix also corrected three benchmark or adapter defects found during the first spike:

- Codex structured-output schemas now close every object, require every declared property, and remove unsupported URI format annotations.
- `matching-01` now treats US citizenship as insufficient proof of an accepted US passport and expects human review.
- Jina classification receives descriptive provider labels and maps the result back to JobKit's canonical value.

## Capability results

Each result is `passed / cases`, mean score, and mean end-to-end latency. Hybrid latency includes both the Jina and Codex stages. Codex account usage is not reported by the paired runner.

| Capability             | Codex                  | Jina                  | Jina + Codex           |
| ---------------------- | ---------------------- | --------------------- | ---------------------- |
| Classification         | 19/20, 0.950, 4,199 ms | 5/20, 0.250, 151 ms   | 20/20, 1.000, 4,414 ms |
| Semantic deduplication | 15/15, 1.000, 4,838 ms | 15/15, 1.000, 107 ms  | 15/15, 1.000, 4,752 ms |
| DeepSearch             | 3/3, 1.000, 11,023 ms  | 3/3, 1.000, 64,541 ms | 3/3, 1.000, 73,884 ms  |
| Evidence extraction    | 2/15, 0.508, 5,569 ms  | unsupported           | unsupported            |
| Qualification matching | 7/10, 0.700, 6,358 ms  | 4/10, 0.400, 157 ms   | 7/10, 0.700, 5,033 ms  |
| Reader                 | 3/4, 0.875, 9,896 ms   | 4/4, 1.000, 5,970 ms  | 4/4, 1.000, 17,483 ms  |
| Reranking              | 15/20, 0.811, 6,657 ms | 19/20, 0.900, 102 ms  | 17/20, 0.833, 6,132 ms |
| Message revision       | 8/10, 0.917, 6,776 ms  | unsupported           | unsupported            |
| Search                 | 2/3, 0.667, 10,853 ms  | 3/3, 1.000, 10,459 ms | 2/3, 0.667, 22,741 ms  |

On the same 75 overlapping cases, Codex passed 64 with a 0.876 mean score, Jina passed 53 with a 0.693 mean score, and hybrid passed 68 with a 0.902 mean score. The three variants are still capability-specific; this aggregate is not a reason to route every task through hybrid.

Jina used 469,985 reported tokens and returned 745,571 Reader/Search output characters in the 75-case latest-result set. DeepSearch alone used 463,181 of those tokens. Hybrid used 534,468 Jina-reported tokens and returned 804,547 Reader/Search characters before the Codex stage.

## Stress subsets

| Subset                                       | Codex      | Jina       | Jina + Codex |
| -------------------------------------------- | ---------- | ---------- | ------------ |
| Multilingual, 6 cases                        | 5/6, 0.833 | 4/6, 0.630 | 4/6, 0.630   |
| Prompt injection, 4 Codex and 3 shared cases | 3/4, 0.917 | 1/3, 0.333 | 3/3, 0.926   |

The Test Lab has a blinded preference recorder, but no human preference vote has been submitted. Human preference is therefore unmeasured rather than inferred from automated scores.

## Stability screen

The two apparent promotion candidates received two additional full passes:

| Capability             | Cases | Recorded Jina runs | Passed | Outcome variation |
| ---------------------- | ----: | -----------------: | -----: | ----------------- |
| Semantic deduplication |    15 |                 45 |     45 | none              |
| Reranking              |    20 |                 60 |     57 | none              |

Every case repeated the same pass/fail outcome and score. The sole reranking failure was also stable: `jina-reranker-v3` ranked “Georgian language teacher” above “English teacher in Tbilisi” for the query “English teacher in Georgia.” That is a material semantic ambiguity for this product, not random variance.

## Promotion decision

Codex remains JobKit's authoritative reasoning engine.

- Jina embeddings are approved only as a non-destructive duplicate-candidate generator. Their 45/45 stable result and roughly 45-times lower mean latency justify proposing possible duplicate contacts or organizations for a deterministic or reviewed merge. Jina output must never merge identity, suppress outreach, or claim a recipient by itself.
- Jina reranking is not the authoritative job or campaign ranker. Its aggregate result was stronger and much faster than Codex, but the repeatable Georgia/Georgian failure can put the wrong role first. A future retrieval stage may use it to produce candidates only when the authoritative matching engine and explicit eligibility gates remain final.
- Jina Reader and Search stay optional evaluation adapters. Four Reader cases and three Search cases are enough to keep testing, not enough to replace Codex research or the evidence-verification path.
- Jina classification and qualification matching are not promoted.
- Jina DeepSearch is not promoted. It matched the three narrow expected answers but averaged almost six times Codex latency and consumed 463,181 tokens.
- Hybrid is not a default route. It improved classification in this corpus but added a dependency and latency, inherited Jina's reranking ambiguity, and did not improve matching or search.

The protected Jina credential remains available to the Test Lab. Production behavior must disclose a Jina-backed capability when a narrow promoted call site is added.

No production JobKit route currently calls Jina. The measured promotion target is one optional, non-destructive duplicate-candidate stage for job, organization, contact, and recipient normalization. A Codex-only installation remains complete without Jina. A future Jina-enabled installation may use either an owner-managed hosted key or a user-provided key, but the key-storage and attribution surface has not been implemented. Reranking remains a candidate-ordering experiment behind authoritative eligibility and matching gates; Reader, Search, classification, qualification matching, DeepSearch, and default hybrid routing remain in the lab.

## Primary references

- [Jina Search Foundation API reference](https://api.jina.ai/redoc)
- [Jina Search Foundation OpenAPI explorer](https://api.jina.ai/scalar)
- [Jina v5 text small classification model card](https://huggingface.co/jinaai/jina-embeddings-v5-text-small-classification)
- [Jina v5 text nano classification model card](https://huggingface.co/jinaai/jina-embeddings-v5-text-nano-classification)
- [Jina Reranker API](https://jina.ai/en-US/reranker/)
- [Jina Embeddings API](https://jina.ai/en-US/embeddings/)
- [Jina Reader and Search APIs](https://jina.ai/reader/)
- [Jina Classifier API](https://jina.ai/en-US/classifier/)
- [Jina model selection catalog](https://jina.ai/models/llms.txt)
- [Jina DeepSearch API](https://jina.ai/deepsearch/)
