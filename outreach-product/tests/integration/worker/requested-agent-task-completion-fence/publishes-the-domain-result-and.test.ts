import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createRunner, FAMILIES, testEnv } from "./support/model";
import {
  envWithDatabase,
  interceptBatch,
  readCompletionState,
} from "./support/uploadpng";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe.each(FAMILIES)("$name request-backed completion", ({ create }) => {
  it("publishes the domain result and consumes the temporary guard", async () => {
    const fixture = await create("happy");

    await fixture.complete(testEnv);

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.publishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "completed",
      runStatus: "completed",
    });
  });

  it("publishes no domain result after the request lease expires", async () => {
    const fixture = await create("expired-request");
    await testEnv.DB.prepare(
      "UPDATE agent_task_requests SET lease_expires_at=? WHERE id=?"
    )
      .bind("2000-01-01T00:00:00.000Z", fixture.requestId)
      .run();

    await expect(fixture.complete(testEnv)).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
    });
  });

  it("publishes no domain result after the run lease expires", async () => {
    const fixture = await create("expired-run");
    await testEnv.DB.prepare(
      "UPDATE agent_task_runs SET lease_expires_at=? WHERE id=?"
    )
      .bind("2000-01-01T00:00:00.000Z", fixture.runId)
      .run();

    await expect(fixture.complete(testEnv)).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
    });
  });

  it("publishes no domain result when the run disappears before the batch", async () => {
    const fixture = await create("missing-run");
    const db = interceptBatch(testEnv.DB, async (statements, target) => {
      await target
        .prepare("DELETE FROM agent_task_runs WHERE id=?")
        .bind(fixture.runId)
        .run();
      return target.batch(statements);
    });

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "missing",
    });
  });

  it("publishes no domain result after the request is requeued and reclaimed", async () => {
    const fixture = await create("reclaimed");
    const replacement = await createRunner(
      `replacement-${fixture.runId}`,
      fixture.runner.user.id,
      fixture.runner.user.email,
      fixture.runner.capabilities
    );
    const db = interceptBatch(testEnv.DB, async (statements, target) => {
      const replacementRunId = `replacement-${fixture.runId}`;
      const replacementToken = `replacement-token-${fixture.runId}`;
      await target.batch([
        target
          .prepare(
            `UPDATE agent_task_runs
                SET status='failed',error_code='runner_failure',
                    error_detail='Superseded by test reclaim',
                    completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id=? AND status='running'`
          )
          .bind(fixture.runId),
        target
          .prepare(
            `UPDATE agent_task_requests
                SET status='queued',runner_id=NULL,claimed_at=NULL,
                    lease_expires_at=NULL,lease_token=NULL,
                    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id=? AND status='claimed'`
          )
          .bind(fixture.requestId),
        target
          .prepare(
            `UPDATE agent_task_requests
                SET status='claimed',runner_id=?,attempt_count=attempt_count+1,
                    lease_token=?,claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    lease_expires_at='2099-01-01T00:00:00.000Z',
                    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id=? AND status='queued'`
          )
          .bind(replacement.id, replacementToken, fixture.requestId),
        target
          .prepare(
            `INSERT INTO agent_task_runs
              (id,user_id,runner_id,task_type,source_task_id,prompt_version,
               model,reasoning_effort,source_hash,prompt_hash,status,started_at,
               lease_expires_at,updated_at,attempt_number,lease_token)
             SELECT ?,user_id,?,task_type,source_task_id,prompt_version,model,
                    reasoning_effort,source_hash,prompt_hash,'running',
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    '2099-01-01T00:00:00.000Z',
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),attempt_number+1,?
               FROM agent_task_runs WHERE id=? AND status='failed'`
          )
          .bind(
            replacementRunId,
            replacement.id,
            replacementToken,
            fixture.runId
          ),
      ]);
      return target.batch(statements);
    });

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "failed",
    });
  });

  it("rolls the batch back when a required domain write affects zero rows", async () => {
    const fixture = await create("zero-write");
    const db = interceptBatch(testEnv.DB, (statements, target) => {
      const modified = [...statements];
      modified[fixture.requiredWriteIndex] = target
        .prepare(
          "UPDATE agent_task_runs SET updated_at=updated_at WHERE id=? AND 0"
        )
        .bind(fixture.runId);
      return target.batch(modified);
    });

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
    });
  });

  it("rolls every write back when a later SQL statement fails", async () => {
    const fixture = await create("sql-rollback");
    const db = interceptBatch(testEnv.DB, (statements, target) =>
      target.batch([
        ...statements,
        target
          .prepare(
            "INSERT INTO agent_task_runs SELECT * FROM agent_task_runs WHERE id=?"
          )
          .bind(fixture.runId),
      ])
    );

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(fixture.readDomainState()).resolves.toEqual(
      fixture.unpublishedState
    );
    await expect(readCompletionState(fixture)).resolves.toEqual({
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
    });
  });
});
