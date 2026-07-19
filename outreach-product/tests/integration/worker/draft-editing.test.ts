import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "../../../src/features/profile/schema";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const firstMessage = `Hello,

I have relevant teaching experience with adults and university students in several countries.

Would you be free to speak about the role?

Best,
Integration User
E: draft-editing@example.test`;
const manualMessage = `Hello,

I have relevant teaching experience with adults and university students, including leading review lectures at a university.

Would you be free to speak about the role?

Best,
Integration User
E: draft-editing@example.test`;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("application draft editing", () => {
  it("saves a manual version and restores the preceding message without reusing a version", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "draft-editing@example.test"
    );
    const jobId = "draft-editing-job";
    const timestamp = "2026-07-17T18:00:00.000Z";
    await writeProfile(testEnv.DB, userId, {
      ...defaultProfile,
      citizenship: "United States",
      currentLocation: "Phoenix, Arizona",
      email: "draft-editing@example.test",
      fullName: "Integration User",
      preferredName: "Integration",
    });
    await upsertJob(
      testEnv.DB,
      JobImportSchema.parse({
        applyUrl: "https://example.test/apply",
        company: "Example University",
        country: "Poland",
        id: jobId,
        title: "English instructor",
      }),
      timestamp
    );
    const userJobId = await upsertUserJob(
      testEnv.DB,
      userId,
      jobId,
      1,
      timestamp
    );
    await testEnv.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,created_at)
       VALUES (?,?,?,?,?)`
    )
      .bind("draft-editing-v1", userJobId, 1, firstMessage, timestamp)
      .run();

    const saved = await exports.default.fetch(
      `https://outreach.test/api/jobs/${jobId}/draft`,
      {
        body: JSON.stringify({ message: manualMessage }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    const savedBody = (await saved.json()) as {
      draft: {
        message: string;
        previousMessage: string;
        revisionSource: string;
        version: number;
      };
    };

    expect(saved.status).toBe(200);
    expect(savedBody.draft).toMatchObject({
      message: manualMessage,
      previousMessage: firstMessage,
      revisionSource: "manual_edit",
      version: 2,
    });

    const undone = await exports.default.fetch(
      `https://outreach.test/api/jobs/${jobId}/undo`,
      { headers: { cookie }, method: "POST" }
    );
    const undoneBody = (await undone.json()) as {
      draft: {
        message: string;
        previousMessage: string;
        revisionSource: string;
        version: number;
      };
    };

    expect(undone.status).toBe(200);
    expect(undoneBody.draft).toMatchObject({
      message: firstMessage,
      previousMessage: manualMessage,
      revisionSource: "undo",
      version: 3,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT version,status,revision_source
           FROM application_drafts
          WHERE user_job_id=?
          ORDER BY version`
      )
        .bind(userJobId)
        .all()
    ).toMatchObject({
      results: [
        { revision_source: "generated", status: "superseded", version: 1 },
        { revision_source: "manual_edit", status: "superseded", version: 2 },
        { revision_source: "undo", status: "draft", version: 3 },
      ],
    });
  });
});
