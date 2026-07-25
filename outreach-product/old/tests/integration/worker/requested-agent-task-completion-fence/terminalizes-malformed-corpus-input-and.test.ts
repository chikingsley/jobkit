import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { claimTestLabTask } from "../../../../worker/services/agent-tasks/test-lab-adapter";
import {
  startDocumentBenchmarkRun,
  startTestLabRun,
} from "../../../../worker/services/test-lab/runs";
import { createAuthenticatedUser } from ".././auth";
import { createRunner, testEnv } from "./support/model";
import {
  readQueuedAttempt,
  readTestLabState,
  replaceQueuedRequestInput,
  uploadPng,
} from "./support/uploadpng";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("request-backed claim transactions", () => {
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
