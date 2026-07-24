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

const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

function dispatch(url: string, init?: RequestInit) {
  return server.fetch(
    new Request(url, init),
    testEnv,
    createExecutionContext()
  );
}

describe("canonical origin", () => {
  it("serves robots and the sitemap index from the canonical origin", async () => {
    const robots = await dispatch(
      "https://jobkit.peacockery.studio/robots.txt"
    );
    const sitemap = await dispatch(
      "https://jobkit.peacockery.studio/sitemap.xml"
    );

    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain(
      "Sitemap: https://jobkit.peacockery.studio/sitemap.xml"
    );
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(
      "<loc>https://jobkit.peacockery.studio/sitemaps/jobs.xml</loc>"
    );
  });

  it("emits the canonical link and OG URL on public documents", async () => {
    const response = await dispatch("https://jobkit.peacockery.studio/jobs");
    const html = await response.text();
    const canonicalLink = html.match(/<link[^>]*rel="canonical"[^>]*>/u)?.[0];
    const ogUrl = html.match(/<meta[^>]*property="og:url"[^>]*>/u)?.[0];

    expect(response.status).toBe(200);
    expect(canonicalLink).toContain(
      'href="https://jobkit.peacockery.studio/jobs"'
    );
    expect(ogUrl).toContain(
      'content="https://jobkit.peacockery.studio/jobs"'
    );
  });

  it("accepts auth traffic on the canonical origin", async () => {
    const response = await dispatch(
      "https://jobkit.peacockery.studio/api/auth/sign-up/email",
      {
        body: JSON.stringify({
          email: "canonical-origin-proof@example.test",
          name: "Canonical Origin Proof",
          password: "a-long-enough-password",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://jobkit.peacockery.studio",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
  });
});
