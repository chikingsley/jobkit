import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import server from "../../../src/server";
import { advancePublicProjectionRuns } from "../../../worker/services/public-projection/advancement";
import { promoteProjectionCandidate } from "../../../worker/services/public-projection/promotion";
import { createAuthenticatedUser } from "../worker/auth";
import {
  approveTeflPublication,
  POSTED_JOB,
  readCandidate,
  seedProviderPointRun,
} from "../worker/public-projection-candidates/support/jobposting";
import { finishFinalGraph } from "../worker/public-projection-final-graph/support/lifecycle";
import { timestamp } from "../worker/public-projection-final-graph/support/model";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const LD_JSON_PATTERN =
  /<script type="application\/ld\+json">(.*?)<\/script>/gsu;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function promoteJobPostingFixture(
  runId: string,
  operatorEmail: string,
  job: typeof POSTED_JOB
) {
  await approveTeflPublication();
  const operator = await createAuthenticatedUser(operatorEmail);
  await seedProviderPointRun(runId, job);
  await finishFinalGraph(testEnv.DB, runId, timestamp);
  await advancePublicProjectionRuns(testEnv.DB);
  await advancePublicProjectionRuns(testEnv.DB);
  const candidate = await readCandidate(runId);
  await promoteProjectionCandidate(testEnv.DB, {
    allocationId: candidate.allocationId,
    runId,
    userId: operator.userId,
  });
  return candidate;
}

async function fetchDocument(pathname: string) {
  const response = await server.fetch(
    new Request(`https://outreach.test${pathname}`),
    testEnv,
    createExecutionContext()
  );
  return { html: await response.text(), response };
}

function structuredData(html: string) {
  return [...html.matchAll(LD_JSON_PATTERN)].map(
    (match) =>
      JSON.parse(match[1] ?? "null") as Record<string, unknown> & {
        "@type"?: string;
      }
  );
}

describe("public job detail JobPosting JSON-LD", () => {
  it("emits a complete JobPosting that agrees with the visible page", async () => {
    const candidate = await promoteJobPostingFixture(
      "ssr-jobposting-run",
      "ssr-jobposting-operator@example.test",
      POSTED_JOB
    );
    const canonicalPath = `/job/${candidate.publicJobId}/${candidate.version.canonicalSlug}`;
    const { html, response } = await fetchDocument(canonicalPath);
    expect(response.status).toBe(200);

    const scripts = structuredData(html);
    const posting = scripts.find((entry) => entry["@type"] === "JobPosting");
    const breadcrumbs = scripts.find(
      (entry) => entry["@type"] === "BreadcrumbList"
    );
    expect(breadcrumbs).toBeDefined();
    if (!posting) {
      throw new Error("The eligible detail page emitted no JobPosting");
    }

    expect(posting).toMatchObject({
      "@context": "https://schema.org",
      datePosted: "2026-07-20",
      hiringOrganization: {
        "@type": "Organization",
        name: "Example School",
      },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressCountry: "GE",
          addressLocality: "Tbilisi",
        },
      },
      title: "English Teacher",
      validThrough: "2026-09-30",
    });
    expect(typeof posting.description).toBe("string");
    expect((posting.description as string).length).toBeGreaterThan(0);
    expect(posting.url).toBe(
      `https://outreach-product.peacockery.studio${canonicalPath}`
    );
    expect(posting).not.toHaveProperty("directApply");
    expect(posting).not.toHaveProperty("jobLocationType");

    expect(html).toContain("English Teacher");
    expect(html).toContain("Example School");
    expect(html).toContain("Tbilisi");
    expect(html).toContain("Jul 20, 2026");
    expect(posting.description).toBe(candidate.version.descriptionHtml);
  });

  it("emits breadcrumbs only when the posting date is withheld", async () => {
    const candidate = await promoteJobPostingFixture(
      "ssr-jobposting-withheld-run",
      "ssr-jobposting-withheld-operator@example.test",
      {}
    );
    const canonicalPath = `/job/${candidate.publicJobId}/${candidate.version.canonicalSlug}`;
    const { html, response } = await fetchDocument(canonicalPath);
    expect(response.status).toBe(200);

    const scripts = structuredData(html);
    expect(scripts.some((entry) => entry["@type"] === "JobPosting")).toBe(
      false
    );
    expect(scripts.some((entry) => entry["@type"] === "BreadcrumbList")).toBe(
      true
    );

    const decision = await testEnv.DB.prepare(
      `SELECT reason_codes_json FROM public_job_eligibility_decisions
        WHERE public_job_id=? ORDER BY decision_version DESC LIMIT 1`
    )
      .bind(candidate.publicJobId)
      .first<{ reason_codes_json: string }>();
    expect(
      JSON.parse(decision?.reason_codes_json ?? "[]") as string[]
    ).toContain("job_posting_original_date_missing");
  });
});
