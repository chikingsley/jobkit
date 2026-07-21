# Job analysis model bakeoff, 2026-07-21

## Decision

JobKit routes global listing analysis by task:

- Match facts: `gpt-5.6-luna` with medium reasoning.
- Position extraction: `gpt-5.6-terra` with medium reasoning.
- Normalized job content: `gpt-5.6-terra` with medium reasoning.

`gpt-5.3-codex-spark` remains outside this backfill path because exact source-evidence retention is part of the production contract.

## Protocol

The experiment ran each model twice against the same three real listings from Ajarn, ANESL, and ESL Cafe. Each run covered three independent structured-output contracts: match facts, position extraction, and normalized content. Every response passed through its production Zod schema and the production exact-source-evidence validator. Web search stayed disabled. The two runs produced six executions per model and task.

| Model               | Task      | Schema | Exact evidence | Mean latency |
| ------------------- | --------- | -----: | -------------: | -----------: |
| GPT-5.3 Codex Spark | Content   |    6/6 |            2/6 |        8.7 s |
| GPT-5.3 Codex Spark | Facts     |    3/6 |            3/6 |        8.8 s |
| GPT-5.3 Codex Spark | Positions |    6/6 |            1/6 |        5.9 s |
| GPT-5.6 Luna        | Content   |    6/6 |            3/6 |       20.4 s |
| GPT-5.6 Luna        | Facts     |    6/6 |            6/6 |       18.4 s |
| GPT-5.6 Luna        | Positions |    6/6 |            4/6 |       19.3 s |
| GPT-5.6 Terra       | Content   |    6/6 |            6/6 |       15.3 s |
| GPT-5.6 Terra       | Facts     |    6/6 |            6/6 |       18.6 s |
| GPT-5.6 Terra       | Positions |    6/6 |            6/6 |       18.2 s |

Terra produced the strongest normalized prose and achieved full schema and evidence compliance across every task. Luna matched Terra's factual extraction quality with slightly lower mean latency, which makes Luna the focused facts route. Spark supplied the lowest latency and missed the evidence contract often enough to exclude it from this backfill.

## Reproduction

Run the versioned experiment through the JobKit CLI:

```sh
bun run jobkit -- experiments analysis --count 3 --concurrency 3
```

Raw artifacts are local experiment output under `experiments/job-analysis/artifacts/`. The tracked experiment code, corpus reader, schemas, validators, and this decision record preserve the reproducible contract.

This is a route-selection benchmark for the current three production contracts. A broader quality study can add more boards and listing formats through the same harness.
