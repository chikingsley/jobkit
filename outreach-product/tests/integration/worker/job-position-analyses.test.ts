import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { jobSourceHash } from "../../../worker/ai/job-fact-extraction";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("job position analyses", () => {
  it("records evidence-backed child positions for a multi-role listing", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "position-analysis@example.test"
    );
    const timestamp = "2026-07-17T00:00:00.000Z";
    const job = {
      description:
        "We are hiring an English teacher and a high school physics teacher. Salary is 25,000 RMB monthly.",
      salary: "25,000 RMB monthly",
      title: "English and Physics Teachers",
    };
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO jobs
          (id,title,salary,description,apply_url,first_seen_at,updated_at)
         VALUES ('position-job',?,?,?,?,?,?)`
      ).bind(
        job.title,
        job.salary,
        job.description,
        "https://example.test/apply",
        timestamp,
        timestamp
      ),
      testEnv.DB.prepare(
        `INSERT INTO user_jobs
          (id,user_id,job_id,created_at,updated_at)
         VALUES ('position-user-job',?,'position-job',?,?)`
      ).bind(userId, timestamp, timestamp),
    ]);

    const pendingResponse = await exports.default.fetch(
      "https://outreach.test/api/job-position-analyses/pending?ids=position-job",
      { headers: { cookie } }
    );
    const pending = (await pendingResponse.json()) as {
      pending: Array<{ id: string }>;
    };
    expect(pendingResponse.status).toBe(200);
    expect(pending.pending).toEqual([
      expect.objectContaining({ id: "position-job" }),
    ]);

    const analysis = {
      positions: [
        {
          audiences: [],
          certainty: "explicit",
          compensationEvidence: ["Salary is 25,000 RMB monthly"],
          employmentTypes: [],
          evidence: ["English teacher"],
          locations: [],
          requirements: [],
          roleFamily: "english_language",
          subjects: [{ evidence: "English teacher", value: "english" }],
          title: "English teacher",
        },
        {
          audiences: [
            {
              evidence: "high school physics teacher",
              value: "teenagers",
            },
          ],
          certainty: "explicit",
          compensationEvidence: ["Salary is 25,000 RMB monthly"],
          employmentTypes: [],
          evidence: ["high school physics teacher"],
          locations: [],
          requirements: [],
          roleFamily: "subject_specialist",
          subjects: [
            {
              evidence: "high school physics teacher",
              value: "physics",
            },
          ],
          title: "High school physics teacher",
        },
      ],
      reviewNotes: [],
      scope: "multi_position",
    };
    const recordResponse = await exports.default.fetch(
      "https://outreach.test/api/job-position-analyses",
      {
        body: JSON.stringify({
          analysis,
          jobId: "position-job",
          modelId: "deepseek-v4-flash",
          provider: "opencode",
          sourceHash: await jobSourceHash(job),
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(recordResponse.status).toBe(200);
    const rows = await testEnv.DB.prepare(
      `SELECT title,role_family,subjects_json
       FROM job_position_variants
       WHERE job_id='position-job'
       ORDER BY ordinal`
    ).all();
    expect(rows.results).toEqual([
      {
        role_family: "english_language",
        subjects_json: '[{"evidence":"English teacher","value":"english"}]',
        title: "English teacher",
      },
      {
        role_family: "subject_specialist",
        subjects_json:
          '[{"evidence":"high school physics teacher","value":"physics"}]',
        title: "High school physics teacher",
      },
    ]);

    const jobsResponse = await exports.default.fetch(
      "https://outreach.test/api/jobs",
      { headers: { cookie } }
    );
    const jobs = (await jobsResponse.json()) as {
      jobs: Array<{
        id: string;
        positionAnalysis: typeof analysis | null;
      }>;
    };
    expect(jobsResponse.status).toBe(200);
    expect(jobs.jobs[0]?.positionAnalysis).toMatchObject({
      positions: [
        expect.objectContaining({ roleFamily: "english_language" }),
        expect.objectContaining({ roleFamily: "subject_specialist" }),
      ],
      scope: "multi_position",
    });
  });
});
