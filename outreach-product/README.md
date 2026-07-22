# JobKit Outreach Product

The active JobKit web application: a Cloudflare Worker and React interface for reviewing teaching jobs, resolving qualification facts, creating application messages, sending through a user's Gmail account, and tracking replies.

Production: <https://outreach-product.peacockery.studio>

## What is live

- Better Auth identities with rolling D1 sessions.
- Global normalized job inventory with per-user profile, preferences, qualification claims, job state, application drafts, and event history.
- Structured job facts and economics used for fit filtering and compensation sorting.
- Immutable, versioned application drafts with explicit approval and idempotent execution.
- Gmail OAuth sending with a snapshotted R2 attachment packet.
- Authenticated Gmail Pub/Sub reply ingestion, D1 message threads, unread state, and attachment retrieval in the Messages interface.
- SeriousTeachers login-gated form submission with authoritative post-submit verification.
- Country-market catalogs, campaigns, paired Codex task execution, and automation policy.
- TanStack Start and TanStack Router routes with validated URL-backed filters, sort, selected job, and selected message thread.

R2 objects have no public bucket URL. All document operations are authenticated and ownership scoped. Accepted uploads are PDF, DOCX, JPG, and PNG files up to 10 MB.

## Architecture

```text
TanStack Start + React + TanStack Router
        |
Cloudflare Worker (Start SSR, Hono APIs, Better Auth, application executors)
        |-- D1: shared inventory and user-owned workflow/message state
        |-- R2: user-owned documents and immutable send snapshots
        |-- Gmail OAuth: send, thread reconciliation, and reply retrieval
        |-- Gmail Pub/Sub: authenticated push notifications
        `-- Cron: mailbox-watch renewal

job-search/job-data/jobs.sqlite
        `-- bun run inventory:sync --> D1 global inventory

paired local Codex CLI
        `-- outbound HTTPS claim/result protocol --> versioned agent tasks
```

Long-running research and analysis never hold open a Worker request. A user pairs a local `codex login` with a short-lived one-time code, then the local companion claims versioned tasks over outbound HTTPS. JobKit stores only a hash of the revocable companion token. Each task runs in an empty ephemeral workspace with project secrets removed from the child environment and returns a schema-validated result. See [`docs/architecture/codex-agent-runtime.md`](docs/architecture/codex-agent-runtime.md).

## Local development

```bash
bun install
bun run types:worker
bunx wrangler d1 migrations apply jobkit-outreach --local
bun run dev
```

Create an account once in the local UI. Better Auth persists the session in local D1 and an HttpOnly browser cookie.

Put local credentials in an untracked, mode-600 `.dev.vars` file. The Worker validates these names:

```text
BETTER_AUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_PUBSUB_AUDIENCE=...
GOOGLE_PUBSUB_SERVICE_ACCOUNT=...
GOOGLE_PUBSUB_TOPIC=...
MAPBOX_ACCESS_TOKEN=...
JINA_API_KEY=...             # Test Lab and explicitly promoted capabilities
MISTRAL_API_KEY=...          # scanned-document OCR only
SERIOUSTEACHERS_EMAIL=...
SERIOUSTEACHERS_PASSWORD=...
```

Never commit `.dev.vars`, OAuth client JSON, access tokens, pairing codes, or companion tokens.

## Verification and deployment

```bash
bun run fix
bun run check
bun run build
bun run deploy:dry-run
bun run deploy
```

`bun run check` validates generated Worker bindings, Ultracite/Biome, TypeScript (including `tests/`), and the Worker integration suite. Tests live under `tests/`; no source-directory test files are used.

Apply pending migrations before a production deploy:

```bash
bunx wrangler d1 migrations apply jobkit-outreach --remote
```

## Inventory and operations

```bash
# Normalize the local durable source inventory into hosted D1
bun run inventory:sync

# Pair this checkout from Automation, then execute all queued Codex work
bun run jobkit -- agent connect --code <one-time-code>
bun run jobkit -- agent start
```

The source inventory at `../job-search/job-data/jobs.sqlite` supplies raw collector data. D1 is the hosted source of truth for user profiles, preferences, job workflow state, qualification claims, drafts, send attempts, Gmail threads, and replies.

## Documentation

- [`PRODUCT.md`](PRODUCT.md) — canonical product, access, route, rendering, data, SEO, and verification contract.
- [`docs/user-flows/`](docs/user-flows/README.md) — canonical journey and terminal-state contracts.
- [`docs/jobkit-product-prd.md`](docs/jobkit-product-prd.md) — detailed requirements and historical design context.
- [`docs/architecture/codex-agent-runtime.md`](docs/architecture/codex-agent-runtime.md) — Codex pairing, execution, trust, and provider-migration contract.
- [`docs/escape-pathways-product-research.md`](docs/escape-pathways-product-research.md) — research and positioning for expanding from ESL jobs into verified work, training, and relocation routes.
- [`docs/recruiting-business/`](docs/recruiting-business/) — proposed recruiting business, licensing, market order, school offer, candidate pricing, and confidential relocation product.
- [`docs/outreach-and-product-design.md`](docs/outreach-and-product-design.md) — current outreach runtime and state ownership.
- [`../docs/archive/`](../docs/archive/) — dated audits retained as historical evidence.
