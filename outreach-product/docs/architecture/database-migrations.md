# Database schema and migrations

The worker reads and writes D1 through drizzle-orm. The typed schema lives in
`worker/db/schema/` (one module per domain, `index.ts` barrel) and mirrors the
database produced by applying every file in `migrations/` in order.
`tests/unit/schema-drift.test.ts` enforces that mirror: it applies all
migrations to a fresh SQLite database and compares tables, columns, defaults,
primary keys, foreign keys, unique constraints, and indexes (including DESC
ordering and partial `WHERE` clauses) against the drizzle definitions. A
schema edit without a matching migration, or a migration without a matching
schema edit, fails the unit suite.

## Creating a migration

1. Edit the table definitions in `worker/db/schema/`.
2. Run `bun run db:generate -- --name <change-name>`. drizzle-kit diffs the
   schema against the snapshot in `drizzle/meta/`, writes the SQL into the
   `drizzle/` staging directory, and `cli/db/generate.ts` renames it into
   `migrations/` at the next free number after verifying it passes the
   trigger-body rules from `cli/quality/check-migration-triggers.ts`.
3. Review the generated SQL, then apply it with
   `bunx wrangler d1 migrations apply <database> --local` (or `--remote`).

`drizzle/meta/` holds the diff snapshots and must be committed together with
the generated migration. The staged `.sql` files in `drizzle/` are transient;
after promotion only `migrations/` contains SQL.

Hand-written migrations remain valid for anything the schema DSL does not
express: triggers, CHECK constraints, views, and data backfills. Add the file
in `migrations/` at the next free number as before, and update
`worker/db/schema/` in the same change so the drift guard stays green. CHECK
constraints are intentionally absent from the drizzle schema (they live only
in migration SQL), so `db:generate` output for a new table must be extended by
hand when the table needs CHECK guards.

Raw SQL persists in the worker where drizzle cannot express the statement:
trigger-guarded multi-statement batches in `worker/services/public-projection/`
and repository batches whose atomicity depends on statement ordering,
search `MATCH`/ranked queries, and recursive CTEs. Those sites keep typed row
mapping.
