# JobKit collectors

JobKit-owned source collectors live in this Go module. The module follows the standard Go multi-command layout and groups each external board under one domain package:

```text
cmd/jobkit-collect/            thin executable entry point
internal/cli/                  Cobra flags, output, and source construction
internal/inventory/            shared SQLite ledger, resume, and reconciliation
internal/boards/<source>/      one source client, parser, and source tests
internal/sourcehtml/           shared HTML and protected-email primitives
internal/sourcehttp/           shared pacing and bounded HTTP primitives
specs/                         reviewed external source contracts
```

`cmd` is a Go repository convention: each child directory builds one executable. `internal` is enforced by the Go toolchain: packages beneath it cannot be imported from outside this module's parent tree. `specs` is a JobKit repository convention rather than a special Go directory; it records the external behavior the code is expected to implement.

The `internal/boards` grouping is intentional. Adding a board means adding one named package there, a reviewed source contract under `specs`, and CLI construction in `internal/cli/source.go`. Shared packages use domain names such as `inventory`, `sourcehttp`, and `sourcehtml`; there is no generic `utils` package.

## Commands

Run commands from this directory:

```bash
go run ./cmd/jobkit-collect refresh ajarn --mode latest
go run ./cmd/jobkit-collect refresh eslcafe --section international --mode full
go run ./cmd/jobkit-collect runs --board eslcafe-modern
go run ./cmd/jobkit-collect jobs --board tefl --status active
```

Supported sources are `ajarn`, `anesl`, `eslcafe-modern` (or `eslcafe`), `seriousteachers`, `teacherhorizons`, and `tefl`. The default database is `.jobkit/jobs.sqlite`; Override it with `--db` or `JOBKIT_JOBS_DB_PATH`.

`refresh` resumes the active run for the exact source, mode, and source scope. Use `--restart` only when the current run should be canceled and rediscovered. A partial run commits its durable result and exits nonzero. The next invocation fetches only unfinished details.

Retryable source failures such as HTTP 429 and 5xx responses stop the current hydration pass immediately after recording the affected item. A later invocation resumes the same ledger instead of continuing to pressure the source or converting transient responses into a board-wide failure set.

SeriousTeachers application-route resolution is optional. When `SERIOUSTEACHERS_EMAIL` and `SERIOUSTEACHERS_PASSWORD` are present, the source client reuses an authenticated cookie session to resolve gated application routes. Credentials are never written to the inventory.

## Correctness contract

The collector owns source truth:

- validate the source's completion condition before absence reconciliation;
- retain every source listing with a stable identity;
- preserve explicit structured or labeled fields and the original evidence;
- decode Cloudflare-protected email addresses;
- retain the actual application route when the source exposes one;
- commit each detail outcome independently;
- preserve `applied` and `ignored` inventory state during refreshes;
- close absent jobs only after a completed, source-complete `full` run.

The collector does not infer compensation numbers, currency, degree requirements, contract terms, subjects, organization type, or candidate qualification from prose. Those decisions belong to JobKit's evidence-backed Codex tasks. The snapshot publisher likewise leaves semantic values unknown until that analysis exists.

## Adding a source

Use Agent Browser to inspect the real site, record a minimal HAR when useful, and establish authentication, pagination, stable identity, detail, application-route, and completion contracts. Record that reviewed behavior under `specs/`, then implement the smallest board package that proves it. HAR-to-code generation is not part of the maintained path.

Keep network execution sequential unless the source explicitly documents a safe parallel request policy. Go makes concurrency available; it does not make unbounded fan-out correct.

Go tests are colocated with their package as `*_test.go`, which is the standard Go layout. Source fixtures belong in a package-local `testdata/` directory when they are too large to express directly in a test; the Go toolchain ignores `testdata` as a package automatically.

## Validation

```bash
go test -race ./...
go vet ./...
golangci-lint run ./...
go build ./...
```

The historical Python-versus-Go ESL Cafe evaluation is preserved in [`../docs/benchmarks/printing-press-eslcafe-pilot-2026-07-19.md`](../docs/benchmarks/printing-press-eslcafe-pilot-2026-07-19.md). The superseded Python collector and generated Printing Press tree are no longer active code.
