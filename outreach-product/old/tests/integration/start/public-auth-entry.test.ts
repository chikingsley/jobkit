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

const COOKIE_FIELD_PATTERN = /cookie/iu;
const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function fetchDocument(pathname: string, headers?: HeadersInit) {
  const response = await server.fetch(
    new Request(`https://outreach.test${pathname}`, { headers }),
    testEnv,
    createExecutionContext()
  );
  return { html: await response.text(), response };
}

describe("public account entry", () => {
  it("server-renders the signed-out account actions on public pages", async () => {
    const { html, response } = await fetchDocument("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(html).toContain(">Log in</a>");
    expect(html).toContain(">Sign up</a>");
    expect(html).toContain("/app/jobs?signup=true");
    expect(html).not.toContain(">Workspace</a>");
  });

  it("keeps public HTML signed-out and cookie-free for an authenticated visitor", async () => {
    const email = "public-entry-proof@example.test";
    const signUp = await server.fetch(
      new Request("https://outreach.test/api/auth/sign-up/email", {
        body: JSON.stringify({
          email,
          name: "Cache Contract Proof",
          password: "a-long-enough-password",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      testEnv,
      createExecutionContext()
    );
    expect(signUp.ok).toBe(true);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    expect(cookie).toContain("session_token");

    const { html, response } = await fetchDocument("/", { cookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("vary") ?? "").not.toMatch(
      COOKIE_FIELD_PATTERN
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(html).toContain(">Log in</a>");
    expect(html).toContain(">Sign up</a>");
    expect(html).not.toContain(">Workspace</a>");
    expect(html).not.toContain(email);
    expect(html).not.toContain("Cache Contract Proof");
  });

  it("keeps the workspace document private while honoring the signup intent", async () => {
    const { html, response } = await fetchDocument(
      "/app/jobs?signup=true&publicJob=pj_missing"
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("noindex");
    expect(html).toContain("Loading JobKit");
  });
});
