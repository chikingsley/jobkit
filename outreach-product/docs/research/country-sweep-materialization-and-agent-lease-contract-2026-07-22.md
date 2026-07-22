# Country sweep materialization and agent lease contract

**Status:** Accepted implementation contract\
**Date:** July 22, 2026\
**Scope:** Country-sweep output acceptance, resumable domain materialization, request-backed agent failure, lease expiry, requeue, and attempt history

## Decision

JobKit uses D1 as the authoritative state machine, R2 as the immutable artifact store for large country output, and Cloudflare Queues as an at-least-once wake-up transport. A paired Codex runner produces and uploads validated output. A server-owned materializer publishes organizations, contacts, evidence, campaign targets, and later sweep work through bounded D1 transactions.

Cloudflare Workflows may provide lifecycle visibility and durable high-level coordination. D1 leases, attempt records, cursors, counts, and transactions retain authority over every state transition.

The resulting contract separates two completion events:

1. An agent run completes when JobKit accepts a schema-valid immutable output manifest under the exact active runner lease.
1. Country domain materialization completes after every expected output record, campaign fanout, verification fanout, and sweep progression step commits.

Discovery or verification exhaustion produces `completed_with_gaps` with exact failed-task and missing-coverage counts. Coverage-audit exhaustion produces `failed` because JobKit lacks sufficient evidence to claim finished coverage.

## Current implementation evidence

The current country path publishes organizations and contacts, marks the country task complete, materializes campaign targets, and advances the sweep through separate operations in [`worker/services/country-sweep-tasks.ts`](../../worker/services/country-sweep-tasks.ts). Its organization, contact, campaign-target, verification-task, and discovery-task batches scale with the complete result set.

The current request-backed path claims a request in [`worker/services/agent-task-requests.ts`](../../worker/services/agent-task-requests.ts) and creates its run later in [`worker/services/agent-tasks/run-store.ts`](../../worker/services/agent-tasks/run-store.ts). Expiry currently requeues requests and fails their runs through separate operations. Adapter failure batches key primarily on request, run, runner, and status; an attempt-specific lease token completes the fencing model.

The public-projection implementation supplies proven local patterns for attempt counters, maximum attempts, lease owners, lease tokens, checkpoints, and cursor paging in [`migrations/0049_public_projection_runs.sql`](../../migrations/0049_public_projection_runs.sql) and [`worker/services/public-projection/listing-items.ts`](../../worker/services/public-projection/listing-items.ts).

## Platform facts

The implementation follows these current Cloudflare facts:

- D1 permits a 2,000,000-byte string, BLOB, or row; a 100,000-byte SQL statement; 100 bound parameters per query; and a maximum query duration of 30 seconds. Each Worker invocation receives 50 D1 queries on Workers Free or 1,000 on Workers Paid. Cloudflare recommends smaller batches for large mutations. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- `D1Database::batch()` executes statements sequentially as a SQL transaction. A failed statement aborts or rolls back the complete sequence. See [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Cloudflare Queues provides at-least-once delivery. A message may arrive more than once, and Cloudflare recommends an idempotency key for side effects. A message carries at most 128 KB. See [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) and [Queue limits](https://developers.cloudflare.com/queues/platform/limits/).
- A Workflow event payload and a non-stream step result each carry at most 1 MiB. Workflow steps can retry, and Cloudflare directs side-effecting steps toward idempotent operations. See [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/) and [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).
- R2 supports content-addressed immutable artifacts far beyond the D1 row ceiling. One R2 object can approach 5 TiB. See [R2 limits](https://developers.cloudflare.com/r2/platform/limits/).
- Workers provide 128 MB of memory and plan-dependent inbound request-body ceilings. Streaming and bounded parsing preserve predictable memory use. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

These facts establish one canonical chunk envelope:

```text
MAX_CANONICAL_CHUNK_BYTES = 1,000,000
MAX_RECORDS_PER_CHUNK = 1,000
```

One million bytes stays below the 1 MiB Workflow payload ceiling and the 2,000,000-byte D1 value ceiling. One thousand records follows Cloudflare's published large-mutation batching guidance. Queue messages carry only identifiers and compact counters.

## Schema contract

The migration extends parent tables in place so existing foreign-key identities remain stable. Existing history migrates with a deterministic attempt number and a deterministic nonempty `historical:<run-id>` lease token, matching the enforced run invariant.

### Country sweeps

`country_sweeps.status` accepts:

```text
queued
running
completed
completed_with_gaps
failed
canceled
```

The table gains exact terminal counters:

```sql
task_total INTEGER NOT NULL DEFAULT 0 CHECK (task_total >= 0),
task_completed INTEGER NOT NULL DEFAULT 0 CHECK (task_completed >= 0),
task_failed INTEGER NOT NULL DEFAULT 0 CHECK (task_failed >= 0),
missing_scope_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_scope_count >= 0),
CHECK (task_completed + task_failed <= task_total)
```

### Country sweep tasks

`country_sweep_tasks.status` accepts:

```text
queued
claimed
materializing
completed
failed
```

The table gains:

```sql
input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
lease_token TEXT,
max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
accepted_output_id TEXT,
error_code TEXT NOT NULL DEFAULT '',
CHECK (attempt_count <= max_attempts),
CHECK (
  (
    status = 'claimed'
    AND worker_id IS NOT NULL
    AND trim(worker_id) <> ''
    AND lease_token IS NOT NULL
    AND trim(lease_token) <> ''
    AND lease_expires_at IS NOT NULL
    AND trim(lease_expires_at) <> ''
    AND attempt_count > 0
  )
  OR
  (
    status <> 'claimed'
    AND worker_id IS NULL
    AND lease_token IS NULL
    AND lease_expires_at IS NULL
  )
),
CHECK (status <> 'materializing' OR accepted_output_id IS NOT NULL)
```

`UNIQUE(id, sweep_id)` supports exact composite references from output and materialization records.

### Agent task requests

`agent_task_requests` gains:

```sql
attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
lease_token TEXT,
next_attempt_at TEXT,
last_error_code TEXT NOT NULL DEFAULT '',
retry_of_request_id TEXT REFERENCES agent_task_requests(id) ON DELETE SET NULL,
CHECK (attempt_count <= max_attempts),
CHECK (
  (
    status = 'claimed'
    AND runner_id IS NOT NULL
    AND lease_token IS NOT NULL
    AND lease_expires_at IS NOT NULL
    AND attempt_count > 0
  )
  OR
  (
    status <> 'claimed'
    AND runner_id IS NULL
    AND lease_token IS NULL
    AND lease_expires_at IS NULL
  )
)
```

`last_error_detail` uses the existing `error_detail` column. A queued retry retains its previous error code and detail for operator visibility.

### Agent task runs

`agent_task_runs` gains:

```sql
attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
lease_token TEXT NOT NULL CHECK (trim(lease_token) <> ''),
error_code TEXT NOT NULL DEFAULT '',
UNIQUE (user_id, task_type, source_task_id, attempt_number)
```

One row records one immutable execution attempt. A later claim creates a fresh run and preserves the failed row as history.

### Country output manifests

```sql
CREATE TABLE country_sweep_outputs (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'uploading',
      'accepted',
      'materializing',
      'materialized',
      'failed',
      'abandoned'
    )
  ),
  next_chunk_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_ordinal >= 0),
  rolling_sha256 TEXT NOT NULL CHECK (length(rolling_sha256) = 64),
  manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL OR length(manifest_sha256) = 64
  ),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  organization_count INTEGER NOT NULL DEFAULT 0 CHECK (organization_count >= 0),
  contact_count INTEGER NOT NULL DEFAULT 0 CHECK (contact_count >= 0),
  scope_count INTEGER NOT NULL DEFAULT 0 CHECK (scope_count >= 0),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(coverage_summary_json)
    AND json_type(coverage_summary_json) = 'object'
    AND length(CAST(coverage_summary_json AS BLOB)) <= 1000000
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  materialized_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, attempt_number),
  UNIQUE (agent_run_id),
  FOREIGN KEY (task_id, sweep_id)
    REFERENCES country_sweep_tasks(id, sweep_id) ON DELETE RESTRICT
);
```

### R2 chunk manifest

```sql
CREATE TABLE country_sweep_output_chunks (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('organizations', 'contacts', 'scopes')),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1000000),
  record_count INTEGER NOT NULL CHECK (record_count BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  UNIQUE (output_id, ordinal)
);
```

The Worker stores chunks in a private `SWEEP_OUTPUTS` R2 binding. The canonical object key includes output ID, ordinal, and SHA-256. Accepted object keys remain immutable. A lifecycle cleanup removes objects attached to abandoned uploading attempts after an operational retention window.

### Materialization items

```sql
CREATE TABLE country_sweep_materialization_items (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'organizations_chunk',
      'contacts_chunk',
      'scopes_chunk',
      'campaign_fanout',
      'verification_fanout',
      'phase_finalize'
    )
  ),
  chunk_id TEXT REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'processing', 'completed', 'failed')
  ),
  cursor_primary TEXT NOT NULL DEFAULT '',
  cursor_secondary TEXT NOT NULL DEFAULT '',
  expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (output_id, kind, sequence),
  CHECK (attempt_count <= max_attempts),
  CHECK (processed_count <= expected_count OR expected_count = 0),
  CHECK (
    (
      status = 'processing'
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND attempt_count > 0
    )
    OR
    (
      status <> 'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  )
);
```

Chunk items use `expected_count = country_sweep_output_chunks.record_count`. Fanout items use zero as an open-ended expected count and advance through stable keyset cursors.

### Output provenance

```sql
CREATE TABLE country_sweep_output_organizations (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  identity_key TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY (output_id, identity_key)
);

CREATE TABLE country_sweep_output_contacts (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  contact_key TEXT NOT NULL,
  contact_point_id TEXT NOT NULL
    REFERENCES organization_contact_points(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY (output_id, contact_key)
);
```

Canonical organization, contact, evidence, scope-task, and campaign-target IDs derive from stable normalized keys. Retries therefore address the same rows.

### Assertions and outbox

```sql
CREATE TABLE transaction_assertions (
  must_equal_one INTEGER NOT NULL CHECK (must_equal_one = 1)
);

CREATE TABLE work_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  available_at TEXT NOT NULL,
  published_at TEXT,
  publish_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    publish_attempt_count >= 0
  ),
  created_at TEXT NOT NULL,
  UNIQUE (topic, aggregate_id, id)
);
```

Every required D1 write is followed by this assertion inside the same batch:

```sql
INSERT INTO transaction_assertions(must_equal_one)
SELECT 0 WHERE changes() <> 1;
```

An unexpected row count violates the check constraint and rolls back the transaction.

## State machines

### Country task

```text
queued
  -> claimed
  -> materializing
  -> completed

claimed
  -> queued   transient runner failure or expiry with attempts remaining
  -> failed   terminal failure or attempts exhausted

materializing
  -> failed   terminal server materialization failure
```

### Agent run

```text
running
  -> completed   validated immutable output accepted
  -> failed      runner failure, expiry, revocation, or validation failure
```

### Country output

```text
uploading
  -> accepted
  -> materializing
  -> materialized

uploading
  -> abandoned

accepted or materializing
  -> failed
```

### Request-backed task

```text
queued
  -> claimed
  -> completed

claimed
  -> queued   retryable failure or expiry with attempts remaining
  -> failed   terminal failure or attempts exhausted

queued
  -> cancelled
```

## Country output transactions

### Claim

The Worker reads an immutable task candidate and prepares its prompt and source hash. It generates `run_id`, `output_id`, and `lease_token`, then submits one D1 batch:

1. Update one queued country task with the exact `input_hash`, set it to `claimed`, increment `attempt_count`, copy the generated token, and set `lease_expires_at` from D1 time plus 30 minutes.
1. Assert one changed task.
1. Insert the agent run by selecting the exact claimed task, token, and attempt.
1. Assert one inserted run.
1. Insert the uploading country output.
1. Assert one inserted output.
1. Set the parent sweep to `running` and initialize `started_at` from D1 time.
1. Assert one parent sweep.

A competing claimant changes zero rows and consumes zero attempts. A changed input hash also changes zero rows and sends the caller through a fresh preparation cycle.

### Chunk upload

The paired runner uploads one canonical chunk at a time through the authenticated run endpoint.

For each upload, the Worker:

1. Validates runner ownership, active runner status, run ID, task ID, attempt number, shared lease token, both active leases according to D1 time, chunk schema, byte count, record count, and exact next ordinal.
1. Computes the canonical chunk SHA-256.
1. Writes the content-addressed object to R2.
1. Inserts the chunk manifest and advances `next_chunk_ordinal`, counters, total bytes, and rolling hash in one D1 transaction under the same live lease.

A lease loss during the R2 operation can produce an orphan content-addressed object. The D1 manifest remains unchanged, and the orphan publishes zero domain state.

### Output acceptance

The finalization request identifies the complete upload. Server-maintained chunk rows, counts, and the rolling hash form the accepted manifest.

One D1 batch:

1. Guards the exact active run, task, runner, attempt, lease token, task type, source ID, source hash, and active runner.
1. Asserts one guarded run.
1. Sets the output to `accepted`, records its final manifest hash and validated coverage summary, and records `accepted_at` from D1 time.
1. Sets the country task to `materializing`, records `accepted_output_id`, and clears its runner lease fields.
1. Sets the agent run to `completed` with a compact result reference containing output ID, manifest hash, byte count, chunk count, and record counts.
1. Inserts one deterministic materialization outbox event.
1. Asserts every required transition.

This acceptance transaction publishes zero organizations, contacts, campaign targets, verification tasks, discovery tasks, or sweep progression.

### Materialization claim

A Queue consumer receives an ID-only wake-up. It claims one eligible item by changing `queued` to `processing`, incrementing `attempt_count`, generating a five-minute server lease token, and returning the item. The claim query joins an `accepted` or `materializing` output and checks stage prerequisites.

Stage order is:

1. Organization chunks.
1. Contact chunks after every organization chunk completes.
1. Scope chunks, campaign fanout, and verification fanout after organization and contact chunks complete.
1. Phase finalization after every prior item completes.

The first successful item claim changes the output from `accepted` to `materializing`.

### Materialization commit

The consumer loads the immutable R2 object, verifies its byte length and SHA-256, and validates its canonical schema again.

Each chunk commit uses a fixed number of statements and set-based `json_each(?)` operations:

- An organization chunk upserts organizations, upserts organization evidence, and inserts output-organization provenance.
- A contact chunk upserts contact points and inserts output-contact provenance.
- A scope chunk inserts deterministic discovery tasks and records the inserted-row count.
- A campaign fanout item inserts deterministic campaign targets through `INSERT ... SELECT ... ORDER BY ... LIMIT 1000` and advances `(organization_id, campaign_id)`.
- A verification fanout item inserts deterministic verification tasks through `INSERT ... SELECT ... ORDER BY ... LIMIT 1000` and advances `organization_id`.

Every domain statement carries the exact materialization-item guard. Every required transition receives a row-count assertion. A lease loss or invariant mismatch therefore rolls back the complete chunk transaction.

Chunk completion records `processed_count = expected_count`. Provenance counts for the exact chunk must equal its expected record count. Existing canonical domain rows may reduce `inserted_count` while preserving the exact processed count.

### Outbox publication and Queue delivery

The outbox dispatcher sends the topic, work-item ID, and aggregate ID. It records `published_at` after a successful Queue send. A send followed by an interrupted D1 acknowledgement creates a duplicate delivery path, which the D1 item claim resolves safely.

The consumer acknowledges a Queue message after a committed D1 transition. A crash before commit triggers redelivery. A crash after commit produces a duplicate delivery that observes the completed item and acknowledges successfully.

Materialization attempt counts increment during successful D1 item claims. Queue delivery retries leave those counts unchanged.

### Task finalization and sweep progression

The finalizer requires:

- every chunk and fanout item in `completed`;
- chunk `processed_count` totals equal to output manifest totals;
- exact output-organization and output-contact provenance counts;
- zero queued or processing sibling items; and
- the exact active finalizer lease.

One bounded D1 transaction then:

1. Marks the output `materialized`.
1. Marks the country task `completed`.
1. Recomputes exact sweep task counters.
1. Inserts one deterministic coverage-audit task when discovery and verification are quiescent.
1. Completes the sweep when its terminal coverage audit produced zero novel work.
1. Inserts an outbox event for newly runnable work.
1. Asserts every required transition.

D1 serializes concurrent finalizers. Unique task scope keys permit exactly one phase-transition task.

## Request-backed claim, failure, and expiry transactions

### Attempt semantics

- A successful claim increments `attempt_count` exactly once.
- The claim transaction creates one immutable run carrying the same attempt number and lease token.
- A claim race consumes zero attempts.
- A runner-reported failure consumes the active attempt.
- A lease expiry consumes the active attempt.
- Queue redelivery consumes zero agent attempts.
- A transient failure requeues the same request while `attempt_count < max_attempts`.
- A terminal failure or exhausted attempt budget fails the request.
- An explicit user retry creates a new request ID linked through `retry_of_request_id`.

### Atomic claim

The request adapter prepares an immutable input/source snapshot, generates the run ID and lease token, and submits one D1 batch:

1. Claim one eligible queued request whose `next_attempt_at` has arrived and whose attempt count remains below its maximum.
1. Increment its attempt count and set runner, token, claim time, and DB-time lease expiry.
1. Assert one request.
1. Insert a run by selecting the exact claimed request, token, and attempt.
1. Assert one run.
1. Apply the adapter's exact domain transition to its running state.
1. Assert the adapter-declared row count.

The adapter returns the prepared envelope after the transaction commits.

### Failure classification

The server maps runner error codes into two classes:

- Retryable: provider transport, provider availability, temporary R2 access, temporary D1 access, and comparable infrastructure failures.
- Terminal: schema-invalid output, evidence-invalid output, source change, policy violation, invalid task input, and explicit runner safety rejection.

Terminal validation results remain available through the failed run and request history. This behavior prevents a schema or evidence failure from entering a hot retry loop.

### Runner-reported failure

A shared `failRequestedAgentTaskWithDomainWrites` transaction requires:

- exact request, run, user, runner, task type, and source task;
- matching request/run attempt numbers and lease tokens;
- request status `claimed`;
- run status `running`;
- both leases active according to D1 time; and
- an active runner registration.

One D1 batch:

1. Installs a transition guard on the exact run.
1. Asserts one guarded run.
1. Applies the adapter's exact retry or terminal domain transition.
1. Asserts every required domain change.
1. Marks the historical run `failed` with an exact error code and detail.
1. Requeues or fails the request according to failure class and remaining attempts.
1. Clears request lease fields and records its last error.
1. Inserts an outbox wake-up when the request returns to `queued`.
1. Asserts every required transition.

Adapter domain transitions include:

- Profile import: retry retains `processing`; terminal failure sets `failed`.
- Test Lab: retry restores `queued`; terminal failure sets `failed`.
- Follow-up drafting: retry restores `scheduled`; terminal failure sets `failed`.
- Campaign dispatch drafting: retry restores `queued` or `calibration` according to its saved dispatch purpose; terminal failure sets `failed`.
- Job draft, ANESL bundle, and message preview: the adapter preserves the pre-request review state on retry and records terminal failure in the owning workflow state where one exists.

Each adapter declares the exact expected row count. A zero-row domain transition rolls back request and run changes.

### Lease expiry

Claims select `queued` requests. A reaper owns expiry transitions for claimed requests.

The reaper selects an exact request/run pair where request and run share attempt number and lease token, both retain active states, and the lease expiry is at or before D1 time. It invokes the same atomic failure transaction with a system-owned `lease_expired` transition. The historical run becomes failed, while the request and domain state return to their retry state or reach terminal failure according to the attempt budget.

The scheduled fallback processes exact request/run pairs within the current invocation's D1 query budget. Each transition remains one independent D1 transaction.

### Revocation

Runner revocation first records `agent_runners.revoked_at`. Every completion, upload, heartbeat, and runner-reported failure guard requires an active runner. This immediately fences further runner publication. The reaper then processes each leased request/run/domain tuple through the same atomic expiry transition.

### Heartbeat

A heartbeat extends request and run leases together under the exact user, runner, run, request, attempt number, and lease token. D1 time supplies the new 30-minute expiry. A heartbeat changes zero attempt counters.

## Workflow role

A Workflow instance may wrap a sweep for operator visibility, waits, and resumptions. Its events and step results contain IDs, hashes, cursors, and counts. Each step calls one idempotent D1 operation. D1 remains the publication mutex and state authority across R2, Queue, and Workflow retries.

## Acceptance matrix

| Case                                                                       | Required evidence                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valid country output under an active lease                                 | Agent run is `completed`; country task is `materializing`; output is `accepted`; catalog, campaign, and progression tables contain zero rows from the output before materialization. |
| Lease expires before output acceptance                                     | Completion returns conflict; catalog, campaign, and progression tables contain zero rows from the attempt; reaper marks its output `abandoned`.                                      |
| Same runner claims a later attempt                                         | The old run and token receive conflict; the later attempt retains its state.                                                                                                         |
| Chunk exceeds 1,000,000 bytes                                              | Upload fails validation; manifest counters and rolling hash remain unchanged.                                                                                                        |
| Chunk exceeds 1,000 records                                                | Upload fails validation; manifest counters and rolling hash remain unchanged.                                                                                                        |
| Chunk ordinal has a gap                                                    | Upload fails validation; later ordinals remain unavailable.                                                                                                                          |
| Chunk hash differs from canonical content                                  | Upload fails validation; D1 records zero chunk metadata.                                                                                                                             |
| Worker stops after R2 put and before D1 chunk commit                       | One orphan content-addressed object may exist; retry safely records the same object; domain tables remain unchanged.                                                                 |
| SQL fails during materialization                                           | D1 rolls back the complete chunk transaction; item retains a retryable state after failure handling.                                                                                 |
| Worker stops after materialization commit and before Queue acknowledgement | Redelivery observes the completed item; canonical domain and provenance counts remain unchanged.                                                                                     |
| Queue delivers the same message twice                                      | Exactly one D1 materialization claim succeeds.                                                                                                                                       |
| Campaign fanout stops between pages                                        | The next claim resumes after the last committed `(organization_id, campaign_id)` cursor.                                                                                             |
| Verification fanout stops between pages                                    | The next claim resumes after the last committed `organization_id` cursor.                                                                                                            |
| Two task finalizers race                                                   | Exactly one deterministic coverage task or terminal sweep transition commits.                                                                                                        |
| Materialization reaches maximum attempts                                   | Output and task record terminal materialization failure; the completed agent run remains successful inference history.                                                               |
| Discovery task reaches terminal failure                                    | Sweep proceeds with exact failed and missing counts and finishes as `completed_with_gaps` when the coverage audit otherwise completes.                                               |
| Verification task reaches terminal failure                                 | Sweep proceeds with exact failed and missing counts and finishes as `completed_with_gaps` when the coverage audit otherwise completes.                                               |
| Coverage-audit task reaches terminal failure                               | Sweep finishes as `failed` with its exact coverage error.                                                                                                                            |
| Active-lease transient request failure                                     | Adapter domain state, request requeue, historical run failure, and outbox wake-up commit together.                                                                                   |
| Active-lease terminal request failure                                      | Adapter domain failure, request failure, and historical run failure commit together.                                                                                                 |
| Lease expires with attempts remaining                                      | Reaper atomically requeues domain and request state and fails the historical run.                                                                                                    |
| Lease expires at maximum attempts                                          | Reaper atomically fails domain, request, and historical run state.                                                                                                                   |
| Completion races expiry                                                    | D1 lease guards allow exactly one transaction to commit.                                                                                                                             |
| Adapter domain update changes zero rows                                    | Required-row assertion rolls back every request and run transition in the batch.                                                                                                     |
| User explicitly retries a failed request                                   | A new request and attempt lineage appear; prior failed request and run history stay immutable.                                                                                       |
| Runner is revoked during work                                              | Runner publication receives conflict immediately; reaper safely requeues or fails each owned attempt.                                                                                |
| Queue retries before a D1 materialization lease expires                    | Materialization attempt count remains unchanged until a fresh D1 claim succeeds.                                                                                                     |

## Implementation order

1. Rebuild request and run tables with attempt-specific lease constraints and add the shared atomic claim, failure, heartbeat, expiry, and revocation transitions.
1. Apply those transitions to every request-backed adapter and complete their failure/expiry acceptance matrix.
1. Rebuild country task and sweep statuses and counters.
1. Add the private R2 output binding, output/chunk manifests, provenance tables, materialization items, transaction assertion table, and D1 outbox.
1. Implement atomic country claim, bounded chunk upload, and output acceptance.
1. Implement Queue-backed chunk and fanout materialization with keyset cursors.
1. Implement finalization, `completed_with_gaps`, coverage-audit failure, and exact counters.
1. Run the full acceptance matrix before the broader `MARKETS-001` end-to-end product proof.
