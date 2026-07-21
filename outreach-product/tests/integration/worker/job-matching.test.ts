import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("job matching facts", () => {
  it("returns versioned evidence facts through the owned job workspace", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "job-matching@example.test"
    );
    const jobId = "matching-job";
    const timestamp = new Date().toISOString();
    const facts = {
      audiences: [],
      benefits: [],
      economics: {
        compensation: {
          amountMaximum: 30_000,
          amountMinimum: 25_000,
          currency: "CNY",
          evidence: ["25,000-30,000 CNY per month"],
          kind: "amount",
          period: "month",
          qualifier: "range",
          taxBasis: "net",
        },
        workload: {
          basis: "onsite",
          evidence: ["Monday-Friday, 8:00-4:30"],
          maximum: 42.5,
          minimum: 42.5,
          period: "week",
        },
      },
      employmentTypes: [],
      marketSegments: [],
      requirements: [
        {
          alternativeGroup: null,
          evidence: "Bachelor's degree required",
          importance: "required",
          kind: "degree",
          label: "Bachelor's degree",
          minimumDegreeLevel: "bachelor",
          minimumLanguageLevel: null,
          minimumYears: null,
          values: [],
        },
      ],
      reviewNotes: [],
    };
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO jobs (id,title,apply_url,first_seen_at,updated_at) VALUES (?,?,?,?,?)"
      ).bind(
        jobId,
        "English Teacher",
        "https://example.test/apply",
        timestamp,
        timestamp
      ),
      testEnv.DB.prepare(
        "INSERT INTO user_jobs (id,user_id,job_id,created_at,updated_at) VALUES (?,?,?,?,?)"
      ).bind(crypto.randomUUID(), userId, jobId, timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO contacts
          (id,display_name,organization_name,role,status,created_at,updated_at)
         VALUES ('contact-test','Hiring Team','Test University','employer','active',?,?)`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO contact_channels
          (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
         VALUES ('contact-channel-test','contact-test','email','jobs@example.test',
                 'jobs@example.test','active',?,?)`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO application_routes
          (id,job_id,kind,destination,contact_channel_id,status,created_at,updated_at)
         VALUES ('route-test',?,'email','jobs@example.test','contact-channel-test',
                 'active',?,?)`
      ).bind(jobId, timestamp, timestamp),
      testEnv.DB.prepare(
        "INSERT INTO job_match_facts (job_id,facts_json,schema_version,model_provider,model_id,source_hash,updated_at) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        jobId,
        JSON.stringify(facts),
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        "cerebras",
        "zai-glm-4.7",
        "source-hash",
        timestamp
      ),
    ]);

    const response = await exports.default.fetch(
      "https://outreach.test/api/jobs",
      { headers: { cookie } }
    );
    const body = (await response.json()) as {
      jobs: Array<{
        applicationRoutes: Array<{
          contact: { id: string; relatedListingCount: number };
        }>;
        id: string;
      }>;
      matches: Record<string, { label: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ id: jobId });
    expect(body.matches[jobId]?.label).toBe("Needs verification");
    expect(body.jobs[0]?.applicationRoutes[0]?.contact).toMatchObject({
      id: "contact-test",
      relatedListingCount: 1,
    });

    const detailResponse = await exports.default.fetch(
      `https://outreach.test/api/jobs/${jobId}`,
      { headers: { cookie } }
    );
    const detail = (await detailResponse.json()) as {
      job: { matchFacts: typeof facts };
    };
    expect(detailResponse.status).toBe(200);
    expect(detail.job.matchFacts).toEqual(facts);
  });
});
