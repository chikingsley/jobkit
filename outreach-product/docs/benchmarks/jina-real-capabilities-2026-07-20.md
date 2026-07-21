# Jina real-inventory capability evaluation

<!-- markdownlint-disable MD013 -->

Date: 2026-07-20

## Decision

Promote `jina-reranker-v3` as the ordering stage after deterministic eligibility
and campaign filters. Keep Codex as the source of evidence-backed extraction and
unresolved reasoning. The 20-case profile-based follow-up put the expected
opportunity first in 20 of 20 cases at 143 milliseconds average, compared with
19 of 20 at 5.84 seconds for Codex Luna.

Do not promote embedding similarity as an automatic organization merge. The
corrected 700-case controlled-alias calibration used 350 known matches and 350
hard negatives from all 360 usable organization roots in the current inventory.
Nano retrieved 298 matches at rank one and 326 by rank five. Stable domain,
normalized-name, and acronym-plus-location rules resolved all 350 known matches
with zero false links while leaving all 350 hard negatives unresolved. That
proves the cascade shape, not real-world precision: an independently adjudicated
real holdout is still required.

Use Codex Luna medium for resume extraction. Across 50 truth-known synthetic
resumes, Luna completed all 50 with 100% scalar accuracy, structured-fact
accuracy, and evidence grounding at 13.95 seconds per profile. Spark completed
all 50 at 5.57 seconds per profile, but five profiles lost education-field
structure and one produced invalid evidence quoting. Spark is not the primary
extractor.

Reader and Search are not production dependencies. Codex performs unknown-school
and opportunity discovery. When that work identifies a recurring structured
source, Agent Browser establishes the reviewed source contract and a
JobKit-owned Go collector becomes the durable ingestion path.

## Corpus

The harness sampled the current local inventory of 6,410 active jobs and created
four deterministic 100-case corpora:

- Reader: 20 pages from each of Ajarn, ANESL, ESL Cafe, Serious Teachers, and
  TEFL.
- Search: 100 employer or application-destination lookups with a known
  destination domain, comprising 21 Ajarn and 79 ESL Cafe listings.
- Reranking: 100 known-item retrieval tasks, each containing one real target and
  nine same-country distractors after a hard country filter.
- Deduplication: 100 repeated-recipient cases built from real listings. All
  labels use exact normalized recipient email, 20 inputs leak that email in
  description text, and 17 cases reverse a pair already present, leaving 83
  independent unordered pairs. The corpus contains no no-match cases.

The known-item reranking task measures whether a target restated by the query
rises after a country filter. It is a latency and API-contract check, not a
personalized relevance evaluation. The provider-blind comparison UI is the
appropriate shape for a future profile-based promotion gate.

## Follow-up evaluations

### Organization identity calibration

The corrected calibration built canonical roots by normalized organization name
and non-personal organization domain before constructing cases. It used
controlled acronym, abbreviation, and normalization variants for positives, plus
same-country, same-location, and token-overlap hard negatives. It did not
include recipient email or phone in embedding text.

| Stage                          |  Result |
| ------------------------------ | ------: |
| Nano rank one                  | 298/350 |
| Nano rank three                | 318/350 |
| Nano rank five                 | 326/350 |
| Stable-rule true links         | 350/350 |
| Stable-rule false links        |   0/350 |
| Hard negatives left unresolved | 350/350 |

The stable rules resolved 119 cases by organization domain, 185 by normalized
name, and 46 by acronym plus exact country and location. An unresolved record
becomes a new organization rather than an automatic fuzzy merge. Nano is
therefore a cheap candidate generator for later review or adjudication, not an
authority.

The corpus is a controlled-alias calibration rooted in real organizations. It is
deliberately recorded as such and must not be described as an independently
human-adjudicated holdout.

### Resume import

The resume experiment generated 50 deterministic synthetic profiles with known
scalar facts, education, languages, credentials, skills, and work history. Five
resumes also contained an instruction-like template note to test source-data
handling. Every extracted fact required a continuous evidence quote from the
resume.

| Model                      | Completed | Scalars | Structure | Evidence | Mean latency |
| -------------------------- | --------: | ------: | --------: | -------: | -----------: |
| `gpt-5.6-luna`, medium     |     50/50 |  100.0% |    100.0% |   100.0% |      13.95 s |
| `gpt-5.3-codex-spark`, low |     50/50 |  100.0% |     98.0% |    98.1% |       5.57 s |

The first Luna pilot exposed one prompt defect: when the resume had no explicit
summary, the model copied the experience overview into `introduction`. Prompt
version `profile-import-v3` now requires an explicit Summary, Profile, or
Objective section and leaves introduction empty otherwise. The repeated 10-case
pilot and the 50-case run then passed completely.

### Profile-based reranking

The follow-up replaced terse lookup queries with 20 complete synthetic candidate
contexts covering experience, credentials, age groups, target markets, required
support, schedule, benefits, and exclusions. The existing Test Lab comparison
remains provider-blind until a preference is recorded.

| Provider/model     | Correct top result | Exact full order | Mean latency |
| ------------------ | -----------------: | ---------------: | -----------: |
| `jina-reranker-v3` |              20/20 |            12/20 |       143 ms |
| `gpt-5.6-luna`     |              19/20 |            11/20 |       5.84 s |

Production ordering should run after hard filters, when the eligible pool or a
user's ranking context changes. The resulting scores should be stored and
reused; changing a display-only filter must not trigger a provider call.

## Results

### Reader

Jina Reader completed 80 of 100 pages. Across successful pages, mean
structured-marker recall was 82.0%, mean collector-description token recall was
96.2%, and median latency was 6.18 seconds. All 20 TEFL requests failed with
HTTP 403.

| Board            | Completed | Marker recall | Description-token recall | Median latency |
| ---------------- | --------: | ------------: | -----------------------: | -------------: |
| Ajarn            |     20/20 |         89.5% |                    92.3% |         3.49 s |
| ANESL            |     20/20 |         73.8% |                    93.5% |         6.92 s |
| ESL Cafe         |     20/20 |         83.8% |                    99.9% |         1.53 s |
| Serious Teachers |     20/20 |         80.8% |                    99.1% |        15.42 s |
| TEFL             |      0/20 |           n/a |                      n/a |            n/a |

### Search

Jina Search found the known destination domain in 52 of 100 cases and placed it
in the first three results in 43 cases. Mean reciprocal rank was 0.424 and
median latency was 11.57 seconds.

Codex found the known destination in 74 of 100 cases and placed it in the first
three results in 68 cases. Mean reciprocal rank was 0.653 and median latency was
24.30 seconds.

The providers both found the destination in 48 cases. Codex alone found 26, Jina
alone found four, and neither found 22; their union therefore found 78 of 100.
Among the 48 shared successes, Codex produced the better rank in ten, Jina in
two, and both produced the same rank in 36.

This metric is a lower bound on useful discovery rather than complete ground
truth. Some known destinations are generic application routes such as Typeform,
Google Forms, Instagram, or another intermediary, while a search provider may
return the employer's official site instead. The measured additive coverage
supports parallel candidate generation, followed by normalization and Codex
verification.

The search corpus represents the boards with 100 extractable known destination
domains in the current inventory. It measures real destination recovery rather
than balanced performance across every board.

### Reranking

Jina placed the known target first in 100 of 100 real, country-filtered
candidate pools. Top-three recall and mean reciprocal rank were both 1.0, with
median latency of 192 milliseconds.

Codex also placed the known target first in all 100 pools, with median latency
of 10.58 seconds. Equal retrieval correctness and roughly 55-times lower median
latency justified the profile-based follow-up reported above; the follow-up
supplied the promotion evidence that this initial check lacked.

The proposed shape, if the personalized evaluation passes, is:

1. Apply deterministic authorization, freshness, qualification, country,
   recipient, and campaign-policy filters.
1. Build a ranking document from the remaining listing and stored analysis.
1. Call the reranker only when that candidate set or the user's ranking context
   changes.
1. Store the provider, model, input version, score, and computed time.
1. Let UI filters operate locally against the stored records without another
   provider request.

### Semantic duplicate retrieval

Every model was evaluated on the same 100 cases at 256 dimensions for three
repeats. The additional dimension sweep used the same corpus at 256, 512, and
768 dimensions.

| Model         | Dimensions | Correct | Corpus latency |
| ------------- | ---------: | ------: | -------------: |
| v5 text nano  |        256 |  90/100 |         4.23 s |
| v5 text nano  |        512 |  89/100 |         6.12 s |
| v5 text nano  |        768 |  89/100 |         7.60 s |
| v5 text small |        256 |  86/100 |         4.14 s |
| v5 text small |        512 |  84/100 |         5.42 s |
| v5 text small |        768 |  85/100 |         7.54 s |
| v3            |        256 |  90/100 |         8.28 s |
| v3            |        512 |  90/100 |        10.39 s |
| v3            |        768 |  90/100 |        10.28 s |
| v4            |        256 |  90/100 |        20.98 s |
| v4            |        512 |  91/100 |        23.20 s |
| v4            |        768 |  90/100 |        22.46 s |

Nano at 256 dimensions also returned 90/100 in all three earlier repeats. V4 at
512 dimensions recovered one additional case but took roughly 5.5 times as long
as nano, while v5 text small was both less accurate and less stable. Nano at 256
dimensions is the follow-up candidate because it is fast and stable, not because
this corpus proves production quality.

Codex selected the expected recipient-cluster member in 98 of 100 cases at a
median of 3.97 seconds per case. Nano missed ten cases; Codex recovered nine of
those and missed one different case. Seven nano failures retained strong visible
same-organization evidence, indicating that the 1,200-character job description
overweights generic job similarity. Three were ANESL route ambiguities: the
model input displayed the same intermediary and `hr@anesl.com` while the hidden
label distinguished other mailboxes, making the expected route unobservable.

Every positive already has the same normalized recipient email, so deterministic
equality solves the measured task without embeddings or Codex. The production
model must instead separate canonical organization/contact entities from
delivery routes and mailboxes. The controlled-alias calibration reported above
now verifies the entity-only representation, hard negatives, and
structured-resolution order. A separate independently adjudicated real holdout
remains necessary to measure entity-link precision and recall, false merges,
Codex call rate, and prevented duplicate outreach.

## Rate behavior

The first 36-cell dimension-and-repeat matrix exceeded the account's
2,000,000-token-per-minute limit by 44,607 tokens and returned HTTP 429. The
paced rerun completed at concurrency one. Production batching must respect the
provider's token window and preserve completed batch results rather than
discarding a whole run after one rate-limit response.

## Reproduction

Run the full real-capability evaluation:

```sh
bun run jobkit -- experiments jina real --providers jina --size 100 --repeats 3 --concurrency 5
```

Run the paced embedding dimension sweep:

```sh
bun run jobkit -- experiments jina real --providers jina --capabilities deduplication --embedding-dimensions 256,512,768 --size 100 --repeats 1 --concurrency 1 --output experiments/jina/artifacts/real-dedup-dimensions.json
```

Run the corrected maximum-root entity calibration:

```sh
bun run jobkit -- experiments jina entity --size 700 --model jina-embeddings-v5-text-nano --dimensions 256 --concurrency 5
```

Run the 50-profile extractor comparison and personalized reranker evaluation:

```sh
bun run jobkit -- experiments onboarding profiles --count 50 --concurrency 5 --model gpt-5.6-luna --effort medium
bun run jobkit -- experiments onboarding profiles --count 50 --concurrency 5 --model gpt-5.3-codex-spark --effort low
bun run jobkit -- experiments onboarding reranking --count 20 --concurrency 3
```

The raw artifacts are intentionally ignored because they contain copied listing
text. The full-capability artifact SHA-256 is
`825a43ad2938757902bbeec6ff867349b927dd4e57ef0e05197f4dceac3b46c7`. The
dimension-sweep artifact SHA-256 is
`72bbaf3cef47405deca703719423b2737bdd4a27df4784c0eca9ea46a2892958`.

The Codex comparison artifact SHA-256 is
`e6729dcc23d5bbcc2da8347c826d97131b155dee426db4ad2f2c480dfc06e3c8`.

The corrected entity-calibration artifact SHA-256 is
`f2e35ffb9ee429f80b414e2aaf7734ab4eb2142e2b23c5c0aa0bfa8c2b2483b4`. The Luna and
Spark 50-profile artifacts are
`fcbd269552f4c785be4d9eb6e403a2d524bfd9ee3392d09ab2c6ce1eb7a23633` and
`9402a3cd35a29b0b9ff4b4210790cfc47d16a36dfd6e091a744b4bb47aab9a98`. The
profile-based reranker artifact is
`fee00cbf603ed30ae34b9e765cc6bf0071e95b201199eb037986cf758cab5577`.

## References

- [Jina Search Foundation API](https://api.jina.ai/redoc)
- [Jina embeddings](https://jina.ai/en-US/embeddings/)
- [Jina v5 text release](https://jina.ai/news/jina-embeddings-v5-text-distilling-4b-quality-into-sub-1b-multilingual-embeddings/)
- [Jina v5 text nano](https://jina.ai/models/jina-embeddings-v5-text-nano/)
