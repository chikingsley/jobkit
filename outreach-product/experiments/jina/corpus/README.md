# Real-listing corpus protocol

## Storage boundary

Use SQLite for the mutable annotation ledger. JobKit already has SQLite tooling, and annotation work needs transactional row updates, review state, and simple resume-after-interruption behavior.

Export each frozen corpus version to Parquet. Use DuckDB to query those immutable snapshots for distribution checks, template leakage, class slices, and aggregate metrics. DuckDB serves as the analysis engine while SQLite remains the authoritative annotation database.

PGlite serves embedded PostgreSQL-compatible browser and Bun applications. JobKit's local labeling ledger uses SQLite directly and gains no PostgreSQL compatibility requirement from this experiment.

## Corpus construction

1. Select current real listings from the canonical product database.
1. Normalize obvious markup without rewriting source wording.
1. Group exact duplicates, near duplicates, recruiter reposts, and shared templates before sampling.
1. Sample across boards, countries, languages, employer types, and known hard cases.
1. Freeze source hashes and listing identifiers in a version manifest.
1. Assign whole duplicate/template groups to train or held-out data. Never split one group across both.

## Labeling

Codex can draft both labeling passes. The two passes must run independently and remain blind to each other's output. Agreement becomes a provisional label; disagreements, low-confidence examples, and policy-edge cases enter an adjudication queue.

The operator defines the taxonomy and adjudicates that queue. This avoids asking the operator to hand-label every example while still distinguishing model-assisted labels from a human-reviewed held-out set.

For the first 200-example corpus:

- retain every original example and both raw labels;
- record the prompt, Codex model, reasoning setting, and timestamp for each pass;
- require operator review of held-out disagreements and ambiguous policy cases;
- keep the final held-out labels unchanged while models are tuned;
- add new edge cases to a future corpus version instead of editing the current held-out truth after seeing model failures.

Phase one produced 200 active listings across five boards and 99 countries. The two blind Codex passes agreed on 177 and disagreed on 23; one agreed item received a low-confidence label. The operator adjudicated all 23 disagreements. The final corpus retains 200 labels with provenance for 176 ordinary model agreements, one low-confidence model agreement, and 23 operator decisions.

The frozen grouping pass produced 153 leakage groups. Fifteen groups contain multiple listings, and the largest is a 26-listing ANESL university template family. Groups combine exact sources, the same normalized non-empty company, or reviewed high-overlap five-token templates. A deterministic group-level split assigns 174 listings to training and 26 to held-out evaluation, with all four labels represented on both sides. The immutable Parquet snapshot is ignored by Git alongside the SQLite annotation ledger.

## Private Jina classifiers

Jina's hosted Classifier API exposes `/v1/train`. Training returns a `classifier_id`, and later updates reuse that identifier. Jina supplies the compute. The endpoint defaults `access` to `public`, so JobKit must explicitly send `access: "private"`. The API updates model weights and discards the submitted examples afterward, so JobKit retains its own versioned corpus and training manifest.

A local fine-tune or self-hosted model is a separate experiment. The hosted training endpoint returns an API classifier instead of a portable weight artifact.

On 2026-07-20, the frozen 26-listing zero-shot v3 baseline scored 14/26 accuracy and 0.324 macro-F1. Private training remains blocked at the provider boundary: the full 174-listing request, a four-example diagnostic, and Jina's documented two-example v3 request each returned HTTP 500 from `/v1/train`; `/v1/classify` continued to return HTTP 200. No classifier was created or promoted.
