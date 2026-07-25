import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { APPLICATION_MESSAGE_TASK_TYPE } from "../../../../src/agent-tasks/application-message";
import { createAgentTaskRequest } from "../../../../worker/services/agent-task-requests";
import { claimApplicationMessageTask } from "../../../../worker/services/agent-tasks/application-message-adapter";
import { claimProfileImportTask } from "../../../../worker/services/agent-tasks/profile-import-adapter";
import { importResume } from "../../../../worker/services/profile-imports";
import { createAuthenticatedUser } from ".././auth";
import { createRunner, testEnv } from "./support/model";
import {
  envWithDatabase,
  envWithOverrides,
  interceptBatch,
  queueProfileImport,
  readProfileImport,
  readQueuedAttempt,
} from "./support/uploadpng";

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
});
