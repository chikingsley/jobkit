import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { revokeAgentRunner } from "../../../../worker/services/agent-runners";
import {
  heartbeatAgentTask,
  reapAgentTasks,
} from "../../../../worker/services/agent-task-broker";
import {
  claimProfileImportTask,
  completeProfileImportTask,
  failProfileImportTask,
} from "../../../../worker/services/agent-tasks/profile-import-adapter";
import { readOwnedRunningAgentTask } from "../../../../worker/services/agent-tasks/run-store";
import { createAuthenticatedUser } from ".././auth";
import { createRunner, testEnv } from "./support/model";
import {
  profileProposalOutput,
  queueProfileImport,
  readFailedRun,
  readProfileImport,
  readQueuedAttempt,
} from "./support/uploadpng";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("request-backed attempt lifecycle", () => {
  it("heartbeats the shared pair with one database-authored expiry", async () => {
    const email = "shared-heartbeat@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner("shared-heartbeat", userId, email, [
      "extraction",
    ]);
    const upload = await queueProfileImport(runner, "heartbeat-resume.txt");
    const task = await claimProfileImportTask(testEnv, runner);
    if (!task) {
      throw new Error("Heartbeat fixture task was not claimed");
    }

    const heartbeat = await heartbeatAgentTask(
      testEnv,
      runner,
      task.runId,
      task.leaseToken
    );
    const pair = await testEnv.DB.prepare(
      `SELECT request.lease_expires_at request_expiry,
              run.lease_expires_at run_expiry,
              request.lease_token request_token,run.lease_token run_token
         FROM agent_task_requests request
         JOIN agent_task_runs run ON run.source_task_id=request.id
        WHERE request.id=? AND run.id=?`
    )
      .bind(upload.taskRequestId, task.runId)
      .first<{
        request_expiry: string;
        request_token: string;
        run_expiry: string;
        run_token: string;
      }>();
    expect(pair).toEqual({
      request_expiry: heartbeat.leaseExpiresAt,
      request_token: task.leaseToken,
      run_expiry: heartbeat.leaseExpiresAt,
      run_token: task.leaseToken,
    });
  });

  it("keeps immutable failure history, retries once, and rejects the old attempt", async () => {
    const email = "shared-retry@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner("shared-retry", userId, email, [
      "extraction",
    ]);
    const upload = await queueProfileImport(runner, "retry-resume.txt");
    const firstTask = await claimProfileImportTask(testEnv, runner);
    if (!firstTask) {
      throw new Error("Retry fixture first task was not claimed");
    }
    const firstRun = await readOwnedRunningAgentTask(
      testEnv.DB,
      runner,
      firstTask.runId
    );
    await failProfileImportTask(
      testEnv,
      runner,
      upload.taskRequestId,
      firstTask.runId,
      "Provider was temporarily unavailable",
      "provider_unavailable"
    );

    await expect(readFailedRun(firstTask.runId)).resolves.toEqual({
      attempt_number: 1,
      error_code: "provider_unavailable",
      result_json: null,
      status: "failed",
    });
    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 1,
      last_error_code: "provider_unavailable",
      status: "queued",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM work_outbox
          WHERE aggregate_id=? AND topic='agent_task.request.ready'`
      )
        .bind(upload.taskRequestId)
        .first()
    ).resolves.toEqual({ count: 1 });

    const secondTask = await claimProfileImportTask(testEnv, runner);
    if (!secondTask) {
      throw new Error("Retry fixture second task was not claimed");
    }
    expect(secondTask.attemptNumber).toBe(2);
    expect(secondTask.leaseToken).not.toBe(firstTask.leaseToken);
    await expect(
      completeProfileImportTask(
        testEnv,
        runner,
        firstRun,
        firstTask.runId,
        profileProposalOutput()
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      failProfileImportTask(
        testEnv,
        runner,
        upload.taskRequestId,
        firstTask.runId,
        "Stale failure replay",
        "provider_unavailable"
      )
    ).rejects.toMatchObject({ status: 409 });

    await failProfileImportTask(
      testEnv,
      runner,
      upload.taskRequestId,
      secondTask.runId,
      "Output violated the schema",
      "schema_invalid"
    );
    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 2,
      last_error_code: "schema_invalid",
      status: "failed",
    });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "failed",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT attempt_number,status,result_json FROM agent_task_runs
          WHERE source_task_id=? ORDER BY attempt_number`
      )
        .bind(upload.taskRequestId)
        .all()
    ).resolves.toMatchObject({
      results: [
        { attempt_number: 1, result_json: null, status: "failed" },
        { attempt_number: 2, result_json: null, status: "failed" },
      ],
    });
  });

  it("terminalizes a retryable failure when the attempt budget is exhausted", async () => {
    const email = "shared-exhaustion@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner("shared-exhaustion", userId, email, [
      "extraction",
    ]);
    const upload = await queueProfileImport(runner, "exhaustion-resume.txt");
    await testEnv.DB.prepare(
      "UPDATE agent_task_requests SET max_attempts=1 WHERE id=? AND status='queued'"
    )
      .bind(upload.taskRequestId)
      .run();
    const task = await claimProfileImportTask(testEnv, runner);
    if (!task) {
      throw new Error("Exhaustion fixture task was not claimed");
    }

    await failProfileImportTask(
      testEnv,
      runner,
      upload.taskRequestId,
      task.runId,
      "Provider was temporarily unavailable",
      "provider_unavailable"
    );

    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 1,
      last_error_code: "provider_unavailable",
      status: "failed",
    });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "failed",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM work_outbox WHERE aggregate_id=?"
      )
        .bind(upload.taskRequestId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("reaps expired and revoked attempts through the shared retry transition", async () => {
    const email = "shared-reaper@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const expiredRunner = await createRunner("shared-expired", userId, email, [
      "extraction",
    ]);
    const revokedRunner = await createRunner("shared-revoked", userId, email, [
      "extraction",
    ]);
    const expired = await queueProfileImport(
      expiredRunner,
      "expired-reaper-resume.txt"
    );
    const expiredTask = await claimProfileImportTask(testEnv, expiredRunner);
    const revoked = await queueProfileImport(
      revokedRunner,
      "revoked-reaper-resume.txt"
    );
    const revokedTask = await claimProfileImportTask(testEnv, revokedRunner);
    if (!(expiredTask && revokedTask)) {
      throw new Error("Reaper fixture tasks were not claimed");
    }
    const revokedRun = await readOwnedRunningAgentTask(
      testEnv.DB,
      revokedRunner,
      revokedTask.runId
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "UPDATE agent_task_requests SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?"
      ).bind(expired.taskRequestId),
      testEnv.DB.prepare(
        "UPDATE agent_task_runs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?"
      ).bind(expiredTask.runId),
    ]);
    await revokeAgentRunner(testEnv.DB, userId, revokedRunner.id);

    await expect(
      completeProfileImportTask(
        testEnv,
        revokedRunner,
        revokedRun,
        revokedTask.runId,
        profileProposalOutput()
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      failProfileImportTask(
        testEnv,
        revokedRunner,
        revoked.taskRequestId,
        revokedTask.runId,
        "Revoked runner replay",
        "provider_unavailable"
      )
    ).rejects.toMatchObject({ status: 409 });

    await expect(reapAgentTasks(testEnv, userId)).resolves.toEqual({
      processed: 1,
      selected: 1,
    });
    await expect(reapAgentTasks(testEnv, userId)).resolves.toEqual({
      processed: 1,
      selected: 1,
    });
    await expect(readFailedRun(expiredTask.runId)).resolves.toMatchObject({
      error_code: "lease_expired",
      result_json: null,
      status: "failed",
    });
    await expect(readFailedRun(revokedTask.runId)).resolves.toMatchObject({
      error_code: "runner_revoked",
      result_json: null,
      status: "failed",
    });
    await expect(
      readQueuedAttempt(expired.taskRequestId)
    ).resolves.toMatchObject({ attempt_count: 1, status: "queued" });
    await expect(
      readQueuedAttempt(revoked.taskRequestId)
    ).resolves.toMatchObject({ attempt_count: 1, status: "queued" });
  });
});
