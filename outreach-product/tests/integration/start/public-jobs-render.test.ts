import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import server from "../../../src/server";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const STRONG_ETAG_PATTERN = /^"[0-9a-f]{64}"$/u;
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public jobs server render", () => {
  it("renders the real empty catalog through the repository and route loader", async () => {
    const catalog = await testEnv.DB.prepare(
      "SELECT version FROM public_job_catalog_head"
    ).first<{ version: string }>();
    if (!catalog) {
      throw new Error("The public catalog head is missing");
    }
    const response = await server.fetch(
      new Request("https://outreach.test/jobs"),
      testEnv,
      createExecutionContext()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(response.headers.get("etag")).toMatch(STRONG_ETAG_PATTERN);
    expect(html).toContain("<title>Teaching jobs abroad | JobKit</title>");
    expect(html).toContain("0 opportunities in this view");
    expect(html).toContain("No published jobs match this view");
    expect(html).toContain(`version:"${catalog.version}"`);
  });

  it("returns a real 404 for an unknown market route", async () => {
    const response = await server.fetch(
      new Request("https://outreach.test/jobs/unknown-market"),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(404);
  });
});
