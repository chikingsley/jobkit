import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { APPLICATION_MESSAGE_TASK_TYPE } from "../../../src/agent-tasks/application-message";
import { advertisedPositionQuestion } from "../../../worker/ai/application-message-policy";
import type { AgentRunnerContext } from "../../../worker/app-types";
import type { AppEnv } from "../../../worker/env";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import { revokeAgentRunner } from "../../../worker/services/agent-runners";
import {
  heartbeatAgentTask,
  reapAgentTasks,
} from "../../../worker/services/agent-task-broker";
import { createAgentTaskRequest } from "../../../worker/services/agent-task-requests";
import {
  claimApplicationMessageTask,
  completeApplicationMessageTask,
} from "../../../worker/services/agent-tasks/application-message-adapter";
import type { AgentTaskRunRow } from "../../../worker/services/agent-tasks/contracts";
import {
  claimProfileImportTask,
  completeProfileImportTask,
  failProfileImportTask,
} from "../../../worker/services/agent-tasks/profile-import-adapter";
import { readOwnedRunningAgentTask } from "../../../worker/services/agent-tasks/run-store";
import {
  claimTestLabTask,
  completeTestLabTask,
} from "../../../worker/services/agent-tasks/test-lab-adapter";
import { queueJobDraftGeneration } from "../../../worker/services/application-drafts";
import { importResume } from "../../../worker/services/profile-imports";
import {
  startDocumentBenchmarkRun,
  startTestLabRun,
} from "../../../worker/services/test-lab/runs";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface CompletionFixture {
  complete: (completionEnv: AppEnv) => Promise<unknown>;
  publishedState: DomainState;
  readDomainState: () => Promise<DomainState>;
  requestId: string;
  requiredWriteIndex: number;
  run: AgentTaskRunRow;
  runId: string;
  runner: AgentRunnerContext;
  unpublishedState: DomainState;
}

interface DomainState {
  published: boolean;
  status: string;
}

type FixtureFactory = (suffix: string) => Promise<CompletionFixture>;

const testEnv = env as TestEnv;

const FAMILIES: Array<{ create: FixtureFactory; name: string }> = [
  { create: createApplicationFixture, name: "application message" },
  { create: createProfileImportFixture, name: "profile import" },
  { create: createCorpusTestLabFixture, name: "Test Lab corpus" },
  { create: createDocumentTestLabFixture, name: "Test Lab document OCR" },
];

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("request-backed claim transactions", () => {
  it("surfaces a domain constraint and rolls the claim, run, and attempt back", async () => {
    const email = "claim-domain-constraint@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner(
      "claim-domain-constraint",
      userId,
      email,
      ["extraction"]
    );
    const resume =
      "Alex Teacher\nalex@example.test\n\nEnglish teacher with five years of classroom experience.\n\nTeacher, Example School, 2021 to Present\nTaught English to adult and teenage learners in group classes.";
    const upload = await importResume(
      testEnv,
      runner.user,
      new Request("https://outreach.test/api/profile-imports", {
        body: resume,
        headers: {
          "content-length": String(new TextEncoder().encode(resume).byteLength),
          "content-type": "text/plain",
          "x-jobkit-filename": "constraint-resume.txt",
        },
        method: "PUT",
      })
    );
    const db = interceptBatch(testEnv.DB, (statements, target) =>
      target.batch([
        ...statements,
        target
          .prepare(
            `INSERT INTO agent_task_runs
             SELECT * FROM agent_task_runs WHERE source_task_id=?`
          )
          .bind(upload.taskRequestId),
      ])
    );

    await expect(
      claimProfileImportTask(envWithDatabase(db), runner)
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      testEnv.DB.prepare(
        `SELECT status,attempt_count,runner_id,lease_token
           FROM agent_task_requests WHERE id=?`
      )
        .bind(upload.taskRequestId)
        .first()
    ).resolves.toEqual({
      attempt_count: 0,
      lease_token: null,
      runner_id: null,
      status: "queued",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM agent_task_runs WHERE source_task_id=?"
      )
        .bind(upload.taskRequestId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "processing",
    });
  });

  it("lets one of two racing runners consume the first attempt", async () => {
    const email = "claim-race@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const firstRunner = await createRunner("claim-race-first", userId, email, [
      "extraction",
    ]);
    const secondRunner = await createRunner(
      "claim-race-second",
      userId,
      email,
      ["extraction"]
    );
    const upload = await queueProfileImport(firstRunner, "race-resume.txt");

    const claims = await Promise.allSettled([
      claimProfileImportTask(testEnv, firstRunner),
      claimProfileImportTask(testEnv, secondRunner),
    ]);
    expect(
      claims.filter(
        (claim) => claim.status === "fulfilled" && Boolean(claim.value)
      )
    ).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(
      1
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT status,attempt_count,lease_token FROM agent_task_requests
          WHERE id=?`
      )
        .bind(upload.taskRequestId)
        .first<{ attempt_count: number; lease_token: string; status: string }>()
    ).resolves.toMatchObject({
      attempt_count: 1,
      status: "claimed",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count,MIN(attempt_number) attempt_number
           FROM agent_task_runs WHERE source_task_id=?`
      )
        .bind(upload.taskRequestId)
        .first()
    ).resolves.toEqual({ attempt_number: 1, count: 1 });
  });

  it("preserves queued work when R2 preparation fails", async () => {
    const email = "claim-r2-failure@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner("claim-r2-failure", userId, email, [
      "extraction",
    ]);
    const upload = await queueProfileImport(runner, "r2-failure-resume.txt");
    const documents = new Proxy(testEnv.DOCUMENTS, {
      get(target, property) {
        if (property === "get") {
          return () => Promise.reject(new Error("Synthetic R2 outage"));
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failureEnv = envWithOverrides({ DOCUMENTS: documents });

    await expect(claimProfileImportTask(failureEnv, runner)).rejects.toThrow(
      "Synthetic R2 outage"
    );
    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "",
      status: "queued",
    });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "processing",
    });
  });

  it("terminalizes a missing immutable profile source without an attempt", async () => {
    const email = "claim-missing-profile-source@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner(
      "claim-missing-profile-source",
      userId,
      email,
      ["extraction"]
    );
    const upload = await queueProfileImport(
      runner,
      "missing-profile-source.txt"
    );
    const inputJson = await testEnv.DB.prepare(
      "SELECT input_json FROM agent_task_requests WHERE id=?"
    )
      .bind(upload.taskRequestId)
      .first<string>("input_json");
    const input = z
      .object({ sourceTextKey: z.string() })
      .parse(JSON.parse(inputJson ?? "{}"));
    await testEnv.DOCUMENTS.delete(input.sourceTextKey);

    await expect(claimProfileImportTask(testEnv, runner)).resolves.toBeNull();
    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "invalid_input",
      status: "failed",
    });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "failed",
    });
  });

  it("terminalizes malformed immutable request input without an attempt", async () => {
    const email = "claim-invalid-input@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner("claim-invalid-input", userId, email, [
      "extraction",
    ]);
    const upload = await queueProfileImport(runner, "invalid-input-resume.txt");
    await testEnv.DB.batch([
      testEnv.DB.prepare("DELETE FROM agent_task_requests WHERE id=?").bind(
        upload.taskRequestId
      ),
      testEnv.DB.prepare(
        `INSERT INTO agent_task_requests
          (id,user_id,task_type,subject_type,subject_id,input_json,status,
           created_at,updated_at)
         VALUES (?,?,'profile.import','profile_import',?,'{}','queued',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      ).bind(upload.taskRequestId, userId, upload.id),
    ]);

    await expect(claimProfileImportTask(testEnv, runner)).resolves.toBeNull();
    await expect(readQueuedAttempt(upload.taskRequestId)).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "invalid_input",
      status: "failed",
    });
    await expect(readProfileImport(upload.id)).resolves.toMatchObject({
      proposal_json: null,
      status: "failed",
    });
  });

  it("classifies application input errors separately from preparation errors", async () => {
    const email = "claim-application-classification@example.test";
    const { userId } = await createAuthenticatedUser(email);
    const runner = await createRunner(
      "claim-application-classification",
      userId,
      email,
      ["drafting"]
    );
    const malformed = await createAgentTaskRequest(testEnv.DB, {
      payload: {},
      subjectId: "malformed-application",
      subjectType: "job",
      taskType: APPLICATION_MESSAGE_TASK_TYPE,
      userId,
    });

    await expect(
      claimApplicationMessageTask(testEnv, runner)
    ).resolves.toBeNull();
    await expect(readQueuedAttempt(malformed.id)).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "invalid_input",
      status: "failed",
    });

    const missingSource = await createAgentTaskRequest(testEnv.DB, {
      payload: {
        jobId: "missing-application-job",
        kind: "job_draft",
        mode: "generate",
      },
      subjectId: "missing-application-job",
      subjectType: "job",
      taskType: APPLICATION_MESSAGE_TASK_TYPE,
      userId,
    });
    await expect(
      claimApplicationMessageTask(testEnv, runner)
    ).resolves.toBeNull();
    await expect(readQueuedAttempt(missingSource.id)).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "source_changed",
      status: "failed",
    });
  });

  it("terminalizes malformed corpus input and a missing OCR source", async () => {
    const email = "claim-test-lab-classification@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const runner = await createRunner(
      "claim-test-lab-classification",
      userId,
      email,
      ["evaluation"]
    );
    const corpus = await startTestLabRun(
      testEnv,
      userId,
      "classification-01",
      "codex"
    );
    if (!corpus.agentTaskRequestId) {
      throw new Error("Corpus run did not expose its request");
    }
    await replaceQueuedRequestInput(
      corpus.agentTaskRequestId,
      userId,
      "test_lab.evaluate",
      corpus.id,
      "{}"
    );
    await expect(claimTestLabTask(testEnv, runner)).resolves.toBeNull();
    await expect(readQueuedAttempt(corpus.agentTaskRequestId)).resolves.toEqual(
      {
        attempt_count: 0,
        last_error_code: "invalid_input",
        status: "failed",
      }
    );
    await expect(readTestLabState(corpus.id)).resolves.toMatchObject({
      output_json: null,
      status: "failed",
    });

    const documentId = await uploadPng(cookie, "missing-ocr-source.png");
    const document = await startDocumentBenchmarkRun(testEnv, userId, {
      documentId,
      expectedText: "Visible fixture text",
      variant: "codex_vision",
    });
    if (!document.agentTaskRequestId) {
      throw new Error("Document run did not expose its request");
    }
    await testEnv.DB.prepare(
      "DELETE FROM user_documents WHERE id=? AND user_id=?"
    )
      .bind(documentId, userId)
      .run();
    await expect(claimTestLabTask(testEnv, runner)).resolves.toBeNull();
    await expect(
      readQueuedAttempt(document.agentTaskRequestId)
    ).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "source_changed",
      status: "failed",
    });
    await expect(readTestLabState(document.id)).resolves.toMatchObject({
      output_json: null,
      status: "failed",
    });

    const artifactDocumentId = await uploadPng(
      cookie,
      "missing-ocr-artifact.png"
    );
    const artifactRun = await startDocumentBenchmarkRun(testEnv, userId, {
      documentId: artifactDocumentId,
      expectedText: "Visible artifact fixture text",
      variant: "codex_vision",
    });
    if (!artifactRun.agentTaskRequestId) {
      throw new Error("Artifact run did not expose its request");
    }
    const objectKey = await testEnv.DB.prepare(
      "SELECT object_key FROM user_documents WHERE id=? AND user_id=?"
    )
      .bind(artifactDocumentId, userId)
      .first<string>("object_key");
    if (!objectKey) {
      throw new Error("Artifact fixture did not expose its object key");
    }
    await testEnv.DOCUMENTS.delete(objectKey);

    await expect(claimTestLabTask(testEnv, runner)).resolves.toBeNull();
    await expect(
      readQueuedAttempt(artifactRun.agentTaskRequestId)
    ).resolves.toEqual({
      attempt_count: 0,
      last_error_code: "source_changed",
      status: "failed",
    });
    await expect(readTestLabState(artifactRun.id)).resolves.toMatchObject({
      output_json: null,
      status: "failed",
    });
  });
});

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

async function createApplicationFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-app-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["drafting"]);
  const timestamp = "2026-07-22T00:00:00.000Z";
  const jobId = `completion-app-${suffix}-job`;
  await writeProfile(testEnv.DB, userId, {
    availability: "",
    citizenship: "United States",
    credentials: [],
    currentLocation: "Phoenix, Arizona",
    education: [],
    email,
    experienceLabel: "",
    fields: [],
    fullName: "Integration User",
    introduction: "I teach English to adult and teenage learners.",
    languages: [],
    phone: "",
    preferredName: "Integration",
    profileReviewNotes: [],
    subjectQualifications: [],
    workAuthorization: [],
    workExperience: [],
  });
  await seedMessageFoundation(userId, timestamp);
  const job = JobImportSchema.parse({
    applyEmail: "hiring@example.test",
    applyUrl: "",
    board: "fixture",
    company: "Example University",
    country: "China",
    description:
      "Example University is seeking an English instructor for adult learners.",
    id: jobId,
    location: "Jinan, China",
    messageRoute: "advertised_position",
    opportunityScope: "direct",
    salary: "25,000 CNY monthly",
    title: "English instructor",
  });
  await upsertJob(testEnv.DB, job, timestamp);
  await upsertUserJob(testEnv.DB, userId, jobId, 1, timestamp);
  const request = await queueJobDraftGeneration(testEnv, userId, jobId);
  const task = await claimApplicationMessageTask(testEnv, runner);
  if (!task) {
    throw new Error("Application fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  const question = advertisedPositionQuestion(new Date(), "UTC");
  const output = {
    message: `Hello,\n\nI teach English to adult and teenage learners and would be glad to discuss the English instructor role.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`,
    summary: "Focused the message on adult English teaching.",
  };
  return {
    complete: (completionEnv) =>
      completeApplicationMessageTask(
        completionEnv,
        runner,
        run,
        task.runId,
        output
      ),
    publishedState: { published: true, status: "review" },
    readDomainState: async () => {
      const [drafts, status] = await Promise.all([
        countJobDrafts(userId, jobId),
        readUserJobStatus(userId, jobId),
      ]);
      return { published: drafts === 1, status };
    },
    requestId: request.id,
    requiredWriteIndex: 3,
    run,
    runId: task.runId,
    runner,
    unpublishedState: { published: false, status: "new" },
  };
}

async function createProfileImportFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-profile-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["extraction"]);
  const resume =
    "Alex Teacher\nalex@example.test\n\nEnglish teacher with five years of classroom experience.\n\nTeacher, Example School, 2021 to Present\nTaught English to adult and teenage learners in group classes.";
  const upload = await importResume(
    testEnv,
    runner.user,
    new Request("https://outreach.test/api/profile-imports", {
      body: resume,
      headers: {
        "content-length": String(new TextEncoder().encode(resume).byteLength),
        "content-type": "text/plain",
        "x-jobkit-filename": "resume.txt",
      },
      method: "PUT",
    })
  );
  const task = await claimProfileImportTask(testEnv, runner);
  if (!task) {
    throw new Error("Profile import fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  const emptyText = { confidence: "low", evidence: "", value: "" };
  const output = {
    citizenship: emptyText,
    credentials: [],
    currentLocation: emptyText,
    education: [],
    email: {
      confidence: "high",
      evidence: "alex@example.test",
      value: "alex@example.test",
    },
    experienceLabel: emptyText,
    fullName: {
      confidence: "high",
      evidence: "Alex Teacher",
      value: "Alex Teacher",
    },
    introduction: {
      confidence: "high",
      evidence: "English teacher with five years of classroom experience.",
      value: "English teacher with five years of classroom experience.",
    },
    languages: [],
    phone: emptyText,
    reviewNotes: [],
    skills: [],
    subjectQualifications: [],
    workExperience: [],
  };
  return {
    complete: (completionEnv) =>
      completeProfileImportTask(completionEnv, runner, run, task.runId, output),
    publishedState: { published: true, status: "ready" },
    readDomainState: async () => {
      const state = await readProfileImport(upload.id);
      return {
        published: state?.proposal_json !== null,
        status: state?.status ?? "missing",
      };
    },
    requestId: run.source_task_id,
    requiredWriteIndex: 2,
    run,
    runId: task.runId,
    runner,
    unpublishedState: { published: false, status: "processing" },
  };
}

async function createCorpusTestLabFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-test-lab-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["evaluation"]);
  const testLabRun = await startTestLabRun(
    testEnv,
    userId,
    "classification-01",
    "codex"
  );
  const task = await claimTestLabTask(testEnv, runner);
  if (!task) {
    throw new Error("Test Lab corpus fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  return testLabFixture({
    output: { label: "english_teaching" },
    run,
    runner,
    taskRunId: task.runId,
    testLabRunId: testLabRun.id,
  });
}

async function createDocumentTestLabFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-document-${suffix}@example.test`;
  const { cookie, userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["evaluation"]);
  const documentId = await uploadPng(cookie, `completion-${suffix}.png`);
  const testLabRun = await startDocumentBenchmarkRun(testEnv, userId, {
    documentId,
    expectedText: "Visible fixture text",
    variant: "codex_vision",
  });
  const task = await claimTestLabTask(testEnv, runner);
  if (!task) {
    throw new Error("Test Lab document fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  return testLabFixture({
    output: { pages: [{ index: 0, markdown: "Visible fixture text" }] },
    run,
    runner,
    taskRunId: task.runId,
    testLabRunId: testLabRun.id,
  });
}

function testLabFixture(input: {
  output: unknown;
  run: AgentTaskRunRow;
  runner: AgentRunnerContext;
  taskRunId: string;
  testLabRunId: string;
}): CompletionFixture {
  return {
    complete: (completionEnv) =>
      completeTestLabTask(
        completionEnv,
        input.runner,
        input.run,
        input.taskRunId,
        input.output
      ),
    publishedState: { published: true, status: "completed" },
    readDomainState: async () => {
      const state = await readTestLabState(input.testLabRunId);
      return {
        published: state?.output_json !== null,
        status: state?.status ?? "missing",
      };
    },
    requestId: input.run.source_task_id,
    requiredWriteIndex: 2,
    run: input.run,
    runId: input.taskRunId,
    runner: input.runner,
    unpublishedState: { published: false, status: "running" },
  };
}

async function createRunner(
  suffix: string,
  userId: string,
  email: string,
  capabilities: AgentRunnerContext["capabilities"]
) {
  const timestamp = new Date().toISOString();
  const runner: AgentRunnerContext = {
    capabilities,
    codexVersion: "codex-cli test",
    id: `completion-${suffix}-${crypto.randomUUID()}`,
    name: "Completion fence agent",
    user: {
      email,
      id: userId,
      name: "Integration User",
      role: "operator",
    },
  };
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners
      (id,user_id,name,token_hash,capabilities_json,codex_version,last_seen_at,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      runner.id,
      userId,
      runner.name,
      `${runner.id}-token`,
      JSON.stringify(runner.capabilities),
      runner.codexVersion,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  return runner;
}

async function seedMessageFoundation(userId: string, timestamp: string) {
  const template = "Hello,\n\n[profile-backed application message]";
  await testEnv.DB.prepare(
    `INSERT INTO user_message_foundations
      (id,user_id,version,name,status,voice_rules_json,templates_json,
       created_at,activated_at)
     VALUES (?,?,1,'Test foundation','active',?,?,?,?)`
  )
    .bind(
      `foundation:${userId}`,
      userId,
      JSON.stringify(["Use plain American English."]),
      JSON.stringify({
        advertised_long_general: template,
        advertised_long_young: template,
        advertised_short: template,
        multi_position: template,
        school_outreach_long: template,
        school_outreach_short: template,
      }),
      timestamp,
      timestamp
    )
    .run();
}

async function uploadPng(cookie: string, filename: string) {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    ),
    (character) => character.charCodeAt(0)
  );
  const upload = await exports.default.fetch(
    "https://outreach.test/api/documents",
    {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
        cookie,
        "x-jobkit-category": "test_lab",
        "x-jobkit-filename": encodeURIComponent(filename),
      },
      method: "PUT",
    }
  );
  if (upload.status !== 200) {
    throw new Error(`Test document upload failed (${upload.status})`);
  }
  const documents = await exports.default.fetch(
    "https://outreach.test/api/documents?scope=all",
    { headers: { cookie } }
  );
  const payload = (await documents.json()) as {
    documents: Array<{ filename: string; id: string }>;
  };
  const document = payload.documents.find((item) => item.filename === filename);
  if (!document) {
    throw new Error("Uploaded test document was not listed");
  }
  return document.id;
}

function interceptBatch(
  database: D1Database,
  interceptor: (
    statements: D1PreparedStatement[],
    target: D1Database
  ) => Promise<D1Result[]>
) {
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          interceptor(statements, target);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function envWithDatabase(db: D1Database): AppEnv {
  return new Proxy(testEnv, {
    get(target, property) {
      if (property === "DB") {
        return db;
      }
      return Reflect.get(target, property, target);
    },
  });
}

function envWithOverrides(overrides: Partial<AppEnv>): AppEnv {
  return new Proxy(testEnv, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property);
      }
      return Reflect.get(target, property, target);
    },
  });
}

function queueProfileImport(runner: AgentRunnerContext, filename: string) {
  const resume =
    "Alex Teacher\nalex@example.test\n\nEnglish teacher with five years of classroom experience.\n\nTeacher, Example School, 2021 to Present\nTaught English to adult and teenage learners in group classes.";
  return importResume(
    testEnv,
    runner.user,
    new Request("https://outreach.test/api/profile-imports", {
      body: resume,
      headers: {
        "content-length": String(new TextEncoder().encode(resume).byteLength),
        "content-type": "text/plain",
        "x-jobkit-filename": filename,
      },
      method: "PUT",
    })
  );
}

async function replaceQueuedRequestInput(
  requestId: string,
  userId: string,
  taskType: string,
  subjectId: string,
  inputJson: string
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM agent_task_requests WHERE id=?").bind(
      requestId
    ),
    testEnv.DB.prepare(
      `INSERT INTO agent_task_requests
        (id,user_id,task_type,subject_type,subject_id,input_json,status,
         created_at,updated_at)
       VALUES (?,? ,?,'test_lab_run',?,?, 'queued',
               strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(requestId, userId, taskType, subjectId, inputJson),
    testEnv.DB.prepare(
      "UPDATE test_lab_runs SET agent_task_request_id=? WHERE id=? AND user_id=?"
    ).bind(requestId, subjectId, userId),
  ]);
}

function readQueuedAttempt(requestId: string) {
  return testEnv.DB.prepare(
    `SELECT status,attempt_count,last_error_code
       FROM agent_task_requests WHERE id=?`
  )
    .bind(requestId)
    .first<{
      attempt_count: number;
      last_error_code: string;
      status: string;
    }>();
}

function readFailedRun(runId: string) {
  return testEnv.DB.prepare(
    `SELECT status,attempt_number,error_code,result_json
       FROM agent_task_runs WHERE id=?`
  )
    .bind(runId)
    .first<{
      attempt_number: number;
      error_code: string;
      result_json: string | null;
      status: string;
    }>();
}

function profileProposalOutput() {
  const emptyText = { confidence: "low", evidence: "", value: "" };
  return {
    citizenship: emptyText,
    credentials: [],
    currentLocation: emptyText,
    education: [],
    email: {
      confidence: "high",
      evidence: "alex@example.test",
      value: "alex@example.test",
    },
    experienceLabel: emptyText,
    fullName: {
      confidence: "high",
      evidence: "Alex Teacher",
      value: "Alex Teacher",
    },
    introduction: {
      confidence: "high",
      evidence: "English teacher with five years of classroom experience.",
      value: "English teacher with five years of classroom experience.",
    },
    languages: [],
    phone: emptyText,
    reviewNotes: [],
    skills: [],
    subjectQualifications: [],
    workExperience: [],
  };
}

async function readCompletionState(fixture: CompletionFixture) {
  const [run, request] = await Promise.all([
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_runs WHERE id=?"
    )
      .bind(fixture.runId)
      .first<{ result_json: string | null; status: string }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_requests WHERE id=?"
    )
      .bind(fixture.requestId)
      .first<{ result_json: string | null; status: string }>(),
  ]);
  let guardPresent = false;
  for (const resultJson of [run?.result_json, request?.result_json]) {
    if (resultJson) {
      guardPresent ||= Object.hasOwn(
        JSON.parse(resultJson) as object,
        "completionGuard"
      );
    }
  }
  return {
    guardPresent,
    requestStatus: request?.status ?? "missing",
    runStatus: run?.status ?? "missing",
  };
}

async function countJobDrafts(userId: string, jobId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT COUNT(*) count
       FROM application_drafts draft
       JOIN user_listing_states state ON state.id=draft.user_job_id
      WHERE state.user_id=? AND state.job_id=?`
  )
    .bind(userId, jobId)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

async function readUserJobStatus(userId: string, jobId: string) {
  const state = await testEnv.DB.prepare(
    "SELECT status FROM user_listing_states WHERE user_id=? AND job_id=?"
  )
    .bind(userId, jobId)
    .first<{ status: string }>();
  return state?.status ?? "missing";
}

function readProfileImport(importId: string) {
  return testEnv.DB.prepare(
    "SELECT status,proposal_json FROM profile_imports WHERE id=?"
  )
    .bind(importId)
    .first<{ proposal_json: string | null; status: string }>();
}

function readTestLabState(runId: string) {
  return testEnv.DB.prepare(
    "SELECT status,output_json FROM test_lab_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ output_json: string | null; status: string }>();
}
