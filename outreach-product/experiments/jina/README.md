# Jina experiments

This directory is the canonical home for Jina model experiments. Production adapters remain under `worker/services/test-lab/jina/`; experiment protocols, model catalogs, and local artifacts belong here.

## Model tracks

| Model                                    | JobKit experiment tracks           | Model note                               |
| ---------------------------------------- | ---------------------------------- | ---------------------------------------- |
| [v3](models/v3.md)                       | Text classification and embeddings | Text-only multilingual baseline          |
| [v4](models/v4.md)                       | Classification and embeddings      | Universal multimodal model               |
| [v5 text small](models/v5-text-small.md) | Text classification and embeddings | Larger v5 text model                     |
| [v5 text nano](models/v5-text-nano.md)   | Text classification and embeddings | Latency- and edge-oriented v5 text model |

Reader, Search, Reranker, and DeepSearch are separate Jina services. Each result is attributed to the service that produced it.

## Run the zero-shot classification comparison

```sh
bun run jobkit -- experiments jina \
  --models v3,v4,v5-text-small,v5-text-nano \
  --label-modes descriptive-v1,concise-v1,canonical \
  --repeats 3 \
  --concurrency 1 \
  --output experiments/jina/artifacts/classification.json
```

The command sends the same 20 versioned classification cases in one batch per model, label mode, and repeat. The label modes isolate whether verbose descriptions, concise natural-language labels, or canonical identifiers change zero-shot behavior. Every run uses the same cases and scoring code. The artifact records predictions, provider scores, batch timing, failures, confusion matrices, per-class metrics, and corpus version.

The existing synthetic cases are a harness check. Promotion decisions require the [real-corpus protocol](corpus/README.md), with recruiter and template groups kept on one side of the train/held-out boundary.

## Run the real-inventory capability comparison

```sh
bun run jobkit -- experiments jina real \
  --providers jina,codex \
  --capabilities reader,search,reranking,deduplication \
  --size 100 \
  --repeats 3 \
  --concurrency 3
```

`--capabilities` can isolate one stage, and `--embedding-dimensions` accepts a comma-separated dimension sweep. Reader samples each supported board evenly. Search, reranking, and deduplication use deterministic samples from the current real inventory. Raw artifacts remain ignored because they contain copied listing text; the tracked [real-capability report](../../docs/benchmarks/jina-real-capabilities-2026-07-20.md) records aggregate results, artifact hashes, caveats, and routing decisions.

## Build and label the real corpus

```sh
bun run jobkit -- experiments jina corpus build --size 200
bun run jobkit -- experiments jina corpus label --pass codex-a
bun run jobkit -- experiments jina corpus label --pass codex-b
bun run jobkit -- experiments jina corpus export-review
bun run jobkit -- experiments jina corpus finalize
bun run jobkit -- experiments jina corpus export-frozen
bun run jobkit -- experiments jina corpus evaluate-zero-shot
bun run jobkit -- experiments jina corpus train-evaluate
bun run jobkit -- experiments jina corpus status
```

The ignored SQLite ledger is resumable and retains the source records, hashes, independent labels, operator adjudications, final-label provenance, leakage groups, split assignments, and run metadata. `finalize` reads the completed local Test Lab review and freezes all derived state atomically. `export-frozen` uses the DuckDB CLI through `uvx` to write the ignored Parquet snapshot. Git tracks protocols, aggregate metrics, and conclusions; the ignored artifact directory retains raw listing text, private classifier identifiers, and generated outputs.

## Experiment rules

- Compare models on identical inputs and task settings.
- Record model identifiers, corpus version, latency, errors, and raw scores.
- Separate zero-shot results from private-classifier results.
- Inspect class-level failures and ambiguous examples; an aggregate score is insufficient for routing decisions.
- Keep generated artifacts and real listing text out of Git. Commit protocols, manifests, aggregate metrics, and conclusions.
