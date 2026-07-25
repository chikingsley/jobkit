import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTACHMENT_COPY_STATEMENT_INDEX,
  createAneslRevisionFixture,
  createJobRevisionFixture,
  partialAttachmentCopy,
  testEnv,
} from "./support/model";
import {
  envWithDatabase,
  interceptBatch,
  readRollbackState,
} from "./support/requirelatestdraftid";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe.each([
  { create: createJobRevisionFixture, family: "job revision" },
  { create: createAneslRevisionFixture, family: "ANESL revision" },
])("$family packet snapshot completion", ({ create }) => {
  it.each([
    { copiedAttachments: 0, fault: "zero-copy" },
    { copiedAttachments: 1, fault: "partial-copy" },
  ])(
    "rolls back a $fault attachment snapshot",
    async ({ copiedAttachments, fault }) => {
      const fixture = await create(fault);
      const db = interceptBatch(testEnv.DB, (statements, target) => {
        const modified = [...statements];
        modified[ATTACHMENT_COPY_STATEMENT_INDEX] = partialAttachmentCopy(
          target,
          fixture.sourceDraftId,
          copiedAttachments
        );
        return target.batch(modified);
      });

      await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject(
        { status: 409 }
      );

      await expect(readRollbackState(fixture)).resolves.toEqual({
        attachmentCount: 3,
        draftCount: 1,
        guardPresent: false,
        requestStatus: "claimed",
        runStatus: "running",
        sourceDraftStatus: "draft",
      });
    }
  );

  it("keeps an incomplete source packet out of the revision", async () => {
    const fixture = await create("incomplete-source");
    await testEnv.DB.prepare(
      `DELETE FROM application_draft_attachments
        WHERE draft_id=? AND category='tefl'`
    )
      .bind(fixture.sourceDraftId)
      .run();

    await expect(fixture.complete(testEnv)).rejects.toThrow(
      "valid document packet snapshot"
    );

    await expect(readRollbackState(fixture)).resolves.toEqual({
      attachmentCount: 2,
      draftCount: 1,
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
      sourceDraftStatus: "draft",
    });
  });

  it("rolls back when the source packet becomes stale before the batch", async () => {
    const fixture = await create("stale-source");
    const db = interceptBatch(testEnv.DB, async (statements, target) => {
      await target
        .prepare(
          `DELETE FROM application_draft_attachments
            WHERE draft_id=? AND category='tefl'`
        )
        .bind(fixture.sourceDraftId)
        .run();
      return target.batch(statements);
    });

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(readRollbackState(fixture)).resolves.toEqual({
      attachmentCount: 2,
      draftCount: 1,
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
      sourceDraftStatus: "draft",
    });
  });
});
