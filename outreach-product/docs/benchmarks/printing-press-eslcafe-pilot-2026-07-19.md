# ESL Cafe collector evaluation

Date: 2026-07-20

## Decision

Retain the small JobKit-owned Go collector under `outreach-product/collectors`. Delete the generated Printing Press tree. Use Agent Browser and a reviewed source contract to build future collectors directly.

The Go collector now matches the mature uv collector on source completeness, stable identity, failure signaling, and one-request recovery. It finds more usable contact and application routes on the same immutable pages. Semantic fields remain a separate evidence-backed JobKit stage rather than another set of board-specific regexes.

## What Printing Press established

Agent Browser captured the public ESL Cafe listing requests. The live contract is:

```text
GET https://www.eslcafe.com/api/list/PostAJobList
Accept: application/json
```

ESL Cafe exposes independent `china`, `international`, and `korea` inventories, plus server-rendered HTML details at `/postajob-detail/{slug}`. A direct browser request without the JSON `Accept` header negotiates a different response and is not the application contract.

The HAR identified the endpoint, but its exported entries lacked response bodies. Printing Press therefore could not infer the response envelope, pagination totals, or HTML detail contract. The generated tree also contributed 155 files and a generic CLI, MCP, learning, and storage framework that JobKit did not need. Source-specific collection still required substantial handwritten code.

Printing Press was useful as a discovery spike. Its generated output is not a maintained JobKit dependency.

## Retained Go design

The retained module has one executable and private domain packages:

```text
outreach-product/collectors/
  cmd/jobkit-collect/
  internal/cli/
  internal/inventory/
  internal/boards/eslcafe/
  specs/eslcafe.md
  specs/eslcafe.openapi.yaml
```

The implementation follows these boundaries:

- `client.go` owns context-aware HTTP, a shared source rate limit, pagination, total validation, bounded responses, and typed HTTP failures;
- `detail.go` accepts structured and free-form advertiser pages, preserves the listing summary as stable identity, decodes Cloudflare email protection, and scores external application links;
- `internal/inventory` uses Go's `database/sql` API with SQLite, per-item transactions, restrictive file permissions, and canonical JobKit inventory columns;
- the runner discovers once, commits each outcome, returns nonzero on partial work, and resumes only unfinished details;
- Cobra is limited to `refresh`, `runs`, and `jobs`; there is no generic command framework or generated surface.

At the time of this evaluation, the ESL Cafe implementation and tests contained 15 Go files, 2,160 lines, and 61,964 bytes. The compiled benchmark binary was 16,632,712 bytes. Source requests remain sequential because correctness and board politeness matter more than unbounded fan-out.

## Immutable comparison

The benchmark captured one three-board snapshot before either implementation ran. It contains six list responses and 335 detail responses, each with its original body, status, content type, capture time, and SHA-256 digest:

| Source board  | Listings |
| ------------- | -------: |
| China         |       57 |
| International |      119 |
| Korea         |      159 |

Both collectors then ran against the same loopback replay with request pacing disabled. A separate recovery pass forced one detail request to return HTTP 503.

| Result                         | uv collector | Go collector |
| ------------------------------ | -----------: | -----------: |
| Clean wall time                |     11.045 s |      1.094 s |
| Peak RSS                       |  120,020 KiB |   35,728 KiB |
| Records discovered             |          335 |          335 |
| Records hydrated               |          335 |          335 |
| Source parser failures         |            0 |            0 |
| Stable source identity matches |          335 |          335 |
| Clean exit                     |            0 |            0 |

The timing is a CPU and implementation comparison, not a promise that a live crawl finishes nine times sooner. With the production one-second request interval, source pacing contributes about 341 seconds to either implementation. Go still uses about one-third of the memory and adds little local processing time.

## Failure and resume proof

The forced HTTP 503 produced the required observable failure:

| Recovery result           | uv collector | Go collector |
| ------------------------- | -----------: | -----------: |
| First-run exit            |            1 |            1 |
| First-run hydrated        |          334 |          334 |
| First-run failed          |            1 |            1 |
| Detail requests on resume |            1 |            1 |
| Final hydrated            |          335 |          335 |
| Final state               |    completed |    completed |

The uv HTTP client retried the forced route during its first invocation, so the replay server observed 337 detail requests and three forced failures. Go records the first failed outcome and lets the durable run own the retry. Both paths resume with exactly one request; the Go behavior is simpler to inspect.

## Parser and routing audit

URL, title, company, location, and posted date match on all 335 rows after whitespace normalization. The Go parser differs on seven email fields and thirteen application URL fields. Direct inspection favors Go in those cases:

- it recovers seven clear email addresses that uv leaves blank;
- it recovers application forms or employer routes from twelve rows where uv leaves the route blank;
- it chooses the actual BFITS application form instead of Facebook;
- it chooses the WorknPlay job page instead of a live-chat link.

The free-form parser is the change that fixed the first Go pilot's twelve valid HTTP 200 failures. Those failures were missing implementation, not a Go limitation.

Description strings are not byte-identical because BeautifulSoup and Go's HTML tree walker serialize whitespace differently, and Go replaces protected email placeholders with their decoded addresses. The job record preserves the extracted raw text, while the immutable benchmark snapshot preserves the original HTML response. Semantic extraction therefore does not depend on display-text byte parity.

## Semantic extraction boundary

An intermediate Go pass copied the uv salary, currency, country, degree, and contract regexes. It filled more cells than uv, but spot checks exposed false values, including experience years interpreted as contract length, unrelated numbers interpreted as salary, and degree names treated as requirements merely because the prose mentioned them.

That pass was removed. The Go collector deliberately leaves semantic fields empty and preserves the evidence needed by JobKit's shared extractor. This is a cleaner replacement boundary:

1. Go proves and stores source truth.
1. The shared Codex stage extracts positions, requirements, economics, and evidence.
1. Matching compares those reviewed structures with the candidate profile.

The immutable comparison and this report preserve the uv collector's historical benchmark evidence. After the remaining boards were ported and live-checked, the Python collector tree and its heuristic extraction path were retired; they are no longer an executable fallback or source of truth.
