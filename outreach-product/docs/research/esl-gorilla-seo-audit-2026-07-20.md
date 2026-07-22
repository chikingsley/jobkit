# ESL Gorilla competitive SEO audit

Audited target: <https://eslgorilla.com/>

Audit date: 2026-07-20

This analysis was recovered from the earlier Kasm browser-research run and moved into JobKit as product evidence. It analyzes public routing, structured data, and search positioning; it does not copy competitor content.

## Executive conclusion

ESL Gorilla is beatable. Its visible advantage is primarily programmatic SEO: one topical domain, hundreds of interlinked entity pages, exact-query landing pages, current jobs, and fresh-year language. It does not appear to have an exceptional technical, editorial, product, or backlink moat.

JobKit should combine comparable query coverage with a cleaner canonical architecture and proprietary job data: source provenance, last verification, eligibility, application friction, normalized compensation, duplicate detection, and employer history.

## Current footprint

The live sitemap exposed 883 URLs during the audit:

| Page family                        | URLs |
| ---------------------------------- | ---: |
| Job pages                          |  347 |
| Employer pages                     |  345 |
| Miscellaneous and commercial pages |   72 |
| Country and region pages           |   48 |
| Resource pages                     |   36 |
| City pages                         |   20 |
| Qualification and benefit pages    |   10 |
| Blog pages                         |    5 |

Examples of its search-intent coverage included:

```text
/esl-jobs-china
/jobs/china
/esl-jobs-china-visa-sponsorship
/hire-esl-teachers-china
/jobs/city/beijing
/esl-jobs-no-degree
/esl-jobs-for-non-native-english-teachers
/post-online-esl-jobs
```

Country pages combined exact-match titles and headings, current-year language, salary and benefit copy, live jobs, FAQs, cities, nearby markets, and recruiter-side links. Pages were server rendered and responded quickly in repeated direct measurements.

The domain had at least a small, topically relevant public link footprint, including [TEFL Institute](https://teflinstitute.com/blog/top-ways-to-find-tefl-jobs-guide/#step-3-use-tefl-job-boards-and-agency-listings), [EnglishClub](https://www.englishclub.com/webguide/Teaching_Jobs/), and [Koreabridge](https://koreabridge.net/weblink/eslgorilla). The TEFL Institute mention appeared promotional and may have been a partnership rather than independent editorial endorsement. This was a bounded public audit rather than a complete backlink study.

## Weaknesses to exploit

### Duplicate intent and canonical competition

Both `/esl-jobs-china` and `/jobs/china` were indexable, self-canonical pages targeting essentially the same query. Search surfaced the `/jobs/china` variant while other internal signals emphasized `/esl-jobs-china`.

Other routing defects observed live included:

- `/jobs/city/seoul` rendering and canonicalizing as the South Korea country page;
- `/esl-jobs-mexico` returning HTTP 200 with generic homepage metadata while the real Mexico page was `/jobs/mexico`; and
- internal links redirecting between competing route families.

JobKit should have one canonical location hierarchy. An indexable landing page earns publication through durable demand, current inventory, and unique proprietary data.

### Missing job structured data

The inspected job leaf page had Organization and WebSite schema but lacked a complete `JobPosting` object with `datePosted`, `validThrough`, `hiringOrganization`, `jobLocation`, and compensation. JobKit should follow [Google's JobPosting requirements](https://developers.google.com/search/docs/appearance/structured-data/job-posting), including accurate expiration, canonical deduplication, and Indexing API updates.

### Weak baseline document

One current job page had truncated static metadata and a static Apply link that pointed back to the same job page, while the hydrated JavaScript action worked. JobKit's initial HTML should contain the complete public job, metadata, and a real application entry action.

### Thin high-stakes content

An inspected country guide covering salaries, visas, and relocation had only a few hundred substantive words, stale year language, no obvious author or reviewer, weak sourcing, and no Article schema. Google asks whether consequential content is substantial, original, sourced, and clearly authored in its [people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

### Doorway and scaled-content risk

Near-synonymous commercial pages targeted variations of hire, recruit, post, and advertise English, ESL, and TEFL teachers. JobKit should publish one useful page per intent and avoid thin keyword variants under Google's [doorway and scaled-content policies](https://developers.google.com/search/docs/essentials/spam-policies).

### Thin employer entities and weak verification

The near one-to-one ratio of employer pages to job pages suggested that many employer pages may have been shallow shells. Public claims of verification and experience also lacked a strong visible methodology and author identity. JobKit can make employer pages useful with source evidence, historical listings, duplicate jobs, response behavior, and correction and reporting mechanisms.

## Counter-positioning

> The ESL job board that proves where every role came from, whether it is still open, who can legally apply, and what the application actually requires.

Every normalized job should expose:

- original source and source board;
- first seen, last checked, and last materially changed;
- freshness or closure state and verification method;
- employer-direct, recruiter, or aggregator classification;
- email, external form, account, profile, and screening friction;
- degree, credential, citizenship, language, location, and visa rules;
- salary in original and normalized currency and period;
- housing, airfare, insurance, visa, and contract benefits;
- duplicates across boards;
- employer identity and job history;
- profile-based match explanation; and
- a correction and reporting path.

## Dataset-derived content moat

Prioritize assets that generic prose cannot provide:

- salary reports by country and city;
- visa sponsorship rates;
- markets open to non-native teachers;
- degree and no-degree opportunity counts;
- source-board freshness comparisons;
- application friction by board;
- employer response-time reports;
- scam and expired-job reports;
- duplicate-job analysis; and
- a quarterly ESL hiring index.

## Technical launch gates

- Complete `JobPosting` JSON-LD on active single-position job pages.
- Accurate expiry or removal and Google Indexing API events.
- Accurate sitemap `lastmod` values.
- Breadcrumb and article schema where their visible content supports them.
- One unique self-canonical page per intent.
- Server-rendered public content and a real application entry action.
- Tests for truncated titles, self-link calls to action, canonical mismatch, redirecting internal links, orphan pages, empty city pages, and duplicate title and H1 combinations.
- A market publishing gate based on current inventory and proprietary value.
