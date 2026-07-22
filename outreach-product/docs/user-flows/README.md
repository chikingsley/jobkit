# JobKit user-flow registry

This directory is the canonical journey contract for how a person or operator moves through JobKit. The root [`PRODUCT.md`](../../PRODUCT.md) defines the stable product, access, route, rendering, and shared-data contract. These flow documents define entry points, decisions, state transitions, terminal states, and known implementation gaps.

## Sources of truth

1. `PRODUCT.md` defines the product-wide contract.
1. These documents define the intended user journey.
1. `.maestro/flows/` proves the implemented browser-visible portion of a flow.
1. Worker integration tests prove API authorization and D1 state transitions.
1. `TODO.md` contains unfinished implementation work and references the affected flow IDs.

External products are design references rather than product truth. External protocols become constraints when JobKit must interoperate with them, including Gmail sent/thread state, Google OAuth, job-board forms, and ANESL application instructions.

## Flow registry

| ID         | Actor                        | Journey                                            | Terminal state                                      | Document                                                |
| ---------- | ---------------------------- | -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `FLOW-000` | Public visitor/candidate     | Browse a public job and enter its application flow | Continue browsing or reach the selected application | [Public job discovery](./public-discovery.md)           |
| `FLOW-001` | Candidate                    | Account through first ready workspace              | Ready to apply                                      | [Onboarding](./onboarding.md)                           |
| `FLOW-010` | Candidate                    | Review and send one email application              | Gmail-confirmed sent                                | [Applications](./applications.md)                       |
| `FLOW-011` | Candidate                    | Complete an external or supported form             | Submission recorded                                 | [Applications](./applications.md)                       |
| `FLOW-012` | System with candidate policy | Route and send one ANESL application bundle        | Bundle sent and tracked                             | [Applications](./applications.md)                       |
| `FLOW-020` | Candidate/operator           | Browse and refresh one country market              | Country inventory reconciled                        | [Countries and campaigns](./countries-and-campaigns.md) |
| `FLOW-021` | Candidate                    | Configure and calibrate a country campaign         | Campaign ready to run                               | [Countries and campaigns](./countries-and-campaigns.md) |
| `FLOW-022` | System with candidate policy | Run a paced campaign safely                        | Paused, exhausted, stopped, or failed               | [Countries and campaigns](./countries-and-campaigns.md) |
| `FLOW-030` | Candidate                    | Receive a reply and record the outcome             | Outcome attributed                                  | [Messages](./messages.md)                               |
| `FLOW-040` | Operator/system              | Refresh the global job inventory                   | Inventory reconciled                                | [Inventory operations](./inventory-operations.md)       |

## Maestro policy

Maestro files exercise implemented, passing UI journeys only. A desired step does not enter `.maestro/flows/` until the UI can complete it. Flows that can produce an external side effect use the `live-send` tag and are excluded from the default suite. Credentials are injected at runtime and never stored in YAML.

Maestro validates behavior through the accessibility tree. Responsive layout verification remains a separate check because Maestro web currently uses a preset Chromium viewport rather than the representative iPad-landscape and desktop dimensions in the roadmap.

Run `bun run test:e2e` for every `safe` flow against Wrangler's local D1. Pass a tag to focus the suite, for example `bun run test:e2e campaigns`. The runner creates a local-only account, applies an idempotent fixture, starts the app, and tears it down after the browser run.
