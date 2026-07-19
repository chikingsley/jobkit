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
- Country-market catalogs, bounded sweep tasks, campaigns, runner credentials, and automation policy.
- React Router routes plus URL-backed job filters, sort, selected job, and selected message thread.

R2 objects have no public bucket URL. All document operations are authenticated and ownership scoped. Accepted uploads are PDF, DOCX, JPG, and PNG files up to 10 MB.

## Architecture

```text
React + React Router
        |
Cloudflare Worker (Hono, Better Auth, application executors)
        |-- D1: shared inventory and user-owned workflow/message state
        |-- R2: user-owned documents and immutable send snapshots
        |-- Gmail OAuth: send, thread reconciliation, and reply retrieval
        |-- Gmail Pub/Sub: authenticated push notifications
        `-- Cron: mailbox-watch renewal

job-search/job-data/jobs.sqlite
        `-- bun run inventory:sync --> D1 global inventory
```

The country-sweep runner is intentionally external to the request path. It claims bounded tasks with a revocable runner token and writes structured results back to D1; the browser never receives that token.

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
CEREBRAS_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_PUBSUB_AUDIENCE=...
GOOGLE_PUBSUB_SERVICE_ACCOUNT=...
GOOGLE_PUBSUB_TOPIC=...
MAPBOX_ACCESS_TOKEN=...
MISTRAL_API_KEY=...
SERIOUSTEACHERS_EMAIL=...
SERIOUSTEACHERS_PASSWORD=...
```

Never commit `.dev.vars`, OAuth client JSON, access tokens, or runner tokens.

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

# Run the analysis/economics pipelines with local protected credentials
bun run analyze:jobs
bun run economics:evaluate

# Process country sweep tasks from an authorized runner environment
bun run sweeps:run
```

The source inventory is `../job-search/job-data/jobs.sqlite`. It is not application state. D1 is the hosted source of truth for user profiles, preferences, job workflow state, qualification claims, drafts, send attempts, Gmail threads, and replies.

## Documentation

- [`docs/jobkit-product-prd.md`](docs/jobkit-product-prd.md) — canonical product behavior and direction.
- [`docs/escape-pathways-product-research.md`](docs/escape-pathways-product-research.md) — research and positioning for expanding from ESL jobs into verified work, training, and relocation routes.
- [`docs/recruiting-business/`](docs/recruiting-business/) — proposed recruiting business, licensing, market order, school offer, candidate pricing, and confidential relocation product.
- [`docs/outreach-and-product-design.md`](docs/outreach-and-product-design.md) — design history and the transition from personal local tools to the hosted application.
- [`../docs/archive/`](../docs/archive/) — dated audits retained as historical evidence.
