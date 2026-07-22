# Public job discovery

## FLOW-000: Browse a public job and enter its application flow

**Actor:** Public visitor or signed-in candidate

**Entry:** `/jobs`, a canonical market page, a canonical job URL, or a search-engine result.

### Journey

1. Browse active advertised positions without signing in.
1. Search or filter the public inventory by useful job facts.
1. Open one canonical job page.
1. Read the title, organization, canonical location, compensation and schedule when stated, freshness, source provenance, and the complete normalized description.
1. Review whether the position is active and whether JobKit has a valid application route.
1. Press Apply with JobKit.
1. Sign in and complete onboarding when required. JobKit preserves the selected public job throughout that flow.
1. Open the same position in the authenticated Jobs workspace with private match, documents, recipient, and route controls.
1. Continue through `FLOW-010` or `FLOW-011` according to the active application route.

**Terminal state:** The visitor continues browsing, or the signed-in candidate reaches the correct authenticated application flow for the selected position.

## Public and private presentation

The public page presents complete job facts and the application entry action. It excludes recipient addresses, private source credentials, candidate match, documents, drafts, attempts, and Gmail state. A signed-in visit may hydrate private match and action controls after the public document renders; the server-rendered public response remains safe for shared caching.

The authenticated Jobs workspace is a personalized operational view. It may present the same position inside its list-detail flow, and every `/app/*` route remains private and excluded from search indexing.

## Canonical public routes

| Route                          | Purpose                          | Index policy                               |
| ------------------------------ | -------------------------------- | ------------------------------------------ |
| `/`                            | Product and discovery entry      | Indexable                                  |
| `/jobs`                        | Global active-job browse surface | Indexable                                  |
| `/jobs/:countrySlug`           | Published country market         | Indexable after the market publishing gate |
| `/jobs/:countrySlug/:citySlug` | Published city market            | Indexable after the market publishing gate |
| `/job/:publicId/:slug`         | One active advertised position   | Indexable after the job publishing gate    |
| `/app/*`                       | Candidate workspace              | Authenticated and `noindex`                |

The durable public ID controls job identity. Alternate slugs and retired route variants redirect to the one current canonical URL. Search and filter query URLs remain usable browse state while canonical and indexing policy points search engines to the corresponding published landing page.

## Job publishing gate

Before a job can be indexed, JobKit verifies the conditions in `PRODUCT.md`, renders a complete visible description, and emits structured data from the same canonical record. A source listing that advertises several materially different positions remains a source record until position extraction can support one accurate public page per advertised position.

The publication state and its two independent search gates are explicit and auditable:

- `private` keeps the record inside the candidate workspace.
- `eligible` means the canonical record satisfies the publishing contract.
- `published` means the public route, metadata, structured data, and sitemap entry are active.
- `closed` removes the position from active browse and starts the expiry policy.
- `suppressed` records the source-policy, quality, duplication, or trust reason that prevents publication.
- `organicIndexEligible` records whether the published page provides unique, current public value for general search.
- `jobPostingEligible` records whether one concrete job satisfies every Google `JobPosting` requirement, including the employer's original posting date.

## Search behavior

- The first HTML response contains the visible job content, canonical tag, metadata, and eligible structured data.
- One eligible `JobPosting` object describes one advertised position.
- Market and list pages never receive `JobPosting` markup.
- `lastmod` records a material public-content change.
- Active canonical job URLs enter the sitemap and Google Indexing API lifecycle.
- Closed jobs leave active discovery immediately and follow the retained-history or `410 Gone` policy in `PRODUCT.md`.
- Empty, stale, duplicate, or generic programmatic pages stay outside the index.

## Failure and recovery

- A missing public job returns a meaningful `404` response.
- A permanently retired job without durable public value returns `410 Gone`.
- A temporary data failure returns a visible retry path and a truthful server status rather than an empty successful shell.
- A sign-in interruption preserves the intended job URL and resumes the application flow after authentication.
- A private or suppressed job never leaks through metadata, structured data, sitemap output, or shared caches.

## Verification packet

The independent verification owner proves:

- server-rendered visible content with JavaScript disabled;
- canonical, title, description, robots, breadcrumb, and `JobPosting` output;
- correct `200`, redirect, `404`, and `410` behavior;
- active, changed, and closed sitemap and Indexing API transitions;
- public/private cache separation;
- sign-in return to the selected job;
- phone, iPad portrait, iPad landscape, desktop, and 200% zoom behavior; and
- Rich Results Test and URL Inspection evidence for a launch canary.
