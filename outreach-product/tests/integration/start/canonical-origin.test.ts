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

const CANONICAL_LINK_PATTERN = /<link[^>]*rel="canonical"[^>]*>/u;
const OG_URL_PATTERN = /<meta[^>]*property="og:url"[^>]*>/u;

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

// robots.txt, sitemap.xml, and the job-catalog pages are served by the public
// catalog projection, which is paused. Their coverage sits with that code in
// old/tests. What remains here is the canonical origin itself.
describe("canonical origin", () => {
  it("emits the canonical link and OG URL on public documents", async () => {
    const response = await dispatch("https://jobkit.peacockery.studio/terms");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html.match(CANONICAL_LINK_PATTERN)?.[0]).toContain(
      'href="https://jobkit.peacockery.studio/terms"'
    );
    expect(html.match(OG_URL_PATTERN)?.[0]).toContain(
      'content="https://jobkit.peacockery.studio/terms"'
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
