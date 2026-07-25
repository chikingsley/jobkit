# Architecture

The folder layout follows the product flow. A job is collected, read into
structured facts, matched against the candidate profile, turned into a message,
sent, and its reply tracked. Each of those is one folder, numbered in that
order, so the question "where does this live" is answered by asking "which
stage is it", and the order is visible without reading anything.

## Target layout

Collection itself is not a pipeline stage. The Go collectors are the upstream
producer: they fetch from job boards, parse each listing into a label/value
field map, and write a SQLite ledger. The TypeScript pipeline starts by
*ingesting* that ledger. The seam between the two languages is a file on disk,
nothing more — no Go runs inside the TypeScript tree and no TypeScript runs
inside the collectors.

```
collectors/ (Go)  ──writes──▶  jobs.sqlite ledger
                                    │
                                    ▼
                        src/pipeline/01_ingest/ (TypeScript)
```

```
jobkit/
├─ collectors/            Go. Board scrapers → local job ledger. Upstream of the pipeline.
│
├─ src/
│  ├─ pipeline/           The product. One folder per stage, numbered in flow order.
│  │  ├─ 01_ingest/       ledger → job_listings (validation, versioning, dedupe)
│  │  ├─ 02_extract/      listing → structured facts (source fields, then model)
│  │  ├─ 03_match/        facts + profile → fit and gaps
│  │  ├─ 04_compose/      fit → message (skeletons, policy, prose linter)
│  │  ├─ 05_campaigns/    orchestration at scale: pacing, pausing, resuming
│  │  ├─ 06_deliver/      message → sent (Gmail, board application forms)
│  │  └─ 07_respond/      replies → thread state, follow-ups
│  │
│  ├─ db/                 Drizzle schema, generated migrations, client
│  ├─ model/              Model registry: one place to pick a model per task
│  ├─ server/             HTTP routes, auth, scheduler
│  ├─ web/                React app (routes, features, components)
│  └─ shared/             Types and helpers used by two or more stages
│
├─ cli/                   Thin verbs. Calls into src/. Holds no logic.
├─ docs/capabilities/     One document per pipeline stage.
├─ modules.jsonc          Module manifest. Enforced by check:modules.
└─ old/                   Quarantine. Nothing imports from here.
```

## Rules

**`src/` runs itself, `cli/` only pokes it.** The product operates without a
human: campaigns pace themselves, pause on a reply, and resume. The CLI is a
control surface for an operator or an agent, not a home for behaviour. Any file
under `cli/` that would still be needed if the CLI were deleted belongs in
`src/`.

**One stage owns its tables.** A stage reads from the stage before it and writes
its own rows. When two stages need the same shape, it goes in `src/shared/`,
not into whichever stage happened to define it first.

**Nothing lives outside the manifest.** Every directory has an entry in
`modules.jsonc` with a status. `bun run check:modules` fails when a directory
has no entry, or an entry points at a path that does not exist. Documentation
that is not checked drifts into fiction, so this one is checked.

**Dormant is not deleted.** Work that is paused moves to `old/` with status
`dormant` and keeps its manifest entry. It stops being load-bearing without
being lost.

## Runtime

Local first. The server runs as a normal Bun process against a SQLite file, and
is reachable from outside through a tunnel when it needs to be (OAuth callbacks
and the Gmail push webhook).

Application code does not import Cloudflare runtime APIs. Database access goes
through one client module, so the same code runs against local SQLite or D1
behind an adapter. Keeping that boundary is what makes the hosting choice
reversible.

## Database

`src/db/schema/` is the source of truth. Tables are declared in TypeScript,
`drizzle-kit generate` diffs the schema and writes the migration SQL, and
`src/db/client.ts` is the only module that opens a connection.

Hand-written migration files are not authored going forward. Existing numbered
migrations are kept as history until the schema is squashed to a baseline.
