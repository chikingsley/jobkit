import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

interface SeedOptions {
  draftStatus?: "approved" | "draft";
  employerId: string;
  jobId: string;
  jobStatus?: "failed" | "review";
}

async function seedSubmission({
  draftStatus = "draft",
  employerId,
  jobId,
  jobStatus = "review",
}: SeedOptions) {
  const timestamp = "2026-07-14T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs
       (id,title,company,country,apply_url,employer_id,status,first_seen_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      jobId,
      "Test teaching role",
      "Test school",
      "Poland",
      `https://www.seriousteachers.com/te2/respond/${jobId}/${employerId}`,
      employerId,
      jobStatus,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO application_drafts
       (id,job_id,version,message,status,created_at,approved_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      `draft-${jobId}`,
      jobId,
      1,
      "A precise test application.",
      draftStatus,
      timestamp,
      draftStatus === "approved" ? timestamp : null
    ),
  ]);
}

function htmlResponse(body: string, setCookies: string[] = []) {
  const headers = new Headers({ "content-type": "text/html" });
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(body, { headers });
}

function redirectResponse(setCookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { headers, status: 302 });
}

function mockSeriousTeachers({
  appliedDate,
  employerId,
  jobId,
}: {
  appliedDate?: string;
  employerId: string;
  jobId: string;
}) {
  let submitted = false;
  let submissionPosts = 0;
  const userAgents: (string | null)[] = [];
  const applyUrl = `https://www.seriousteachers.com/te2/respond/${jobId}/${employerId}`;
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    userAgents.push(headers.get("user-agent"));

    if (url.endsWith("/te2/login") && method === "GET") {
      return htmlResponse(
        '<input name="__RequestVerificationToken" value="login-token">',
        ["antiforgery=first; Path=/", "ARRAffinity=first; Path=/"]
      );
    }
    if (url.endsWith("/te2/login") && method === "POST") {
      return redirectResponse(["session=active; Path=/"]);
    }
    if (url.includes("/te2/seriousteachers_panel/")) {
      const date = appliedDate ?? (submitted ? "14 July 2026" : null);
      return htmlResponse(
        date
          ? `<button data-bs-target="#_${jobId}${employerId}">last applied on ${date}</button>`
          : "<main>No application yet</main>"
      );
    }
    if (url === applyUrl && method === "GET") {
      return htmlResponse(
        '<input name="__RequestVerificationToken" value="apply-token"><input name="Teacher.Abroad" value="true"><input name="Teacher.euteacher" value="false">'
      );
    }
    if (url === applyUrl && method === "POST") {
      submitted = true;
      submissionPosts += 1;
      return redirectResponse();
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return {
    submissionPostCount: () => submissionPosts,
    userAgents: () => userAgents,
  };
}

function submit(jobId: string) {
  return exports.default.fetch(
    `https://outreach.test/api/jobs/${jobId}/submit`,
    {
      body: JSON.stringify({ draftId: `draft-${jobId}` }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("application submission", () => {
  it("approves, submits, and verifies through one request", async () => {
    const jobId = "900001";
    const employerId = "800001";
    await seedSubmission({ employerId, jobId });
    const board = mockSeriousTeachers({ employerId, jobId });

    const response = await submit(jobId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Application sent and verified (14 July 2026)",
      ok: true,
    });
    expect(board.submissionPostCount()).toBe(1);
    expect(
      board.userAgents().every((value) => value?.includes("Mozilla/5.0"))
    ).toBe(true);
    expect(
      await env.DB.prepare(
        `SELECT j.status job_status,d.status draft_status,d.submitted_at
         FROM jobs j JOIN application_drafts d ON d.job_id=j.id WHERE j.id=?`
      )
        .bind(jobId)
        .first()
    ).toMatchObject({
      draft_status: "submitted",
      job_status: "applied",
    });
  });

  it("keeps a failed submission retryable and returns the real error", async () => {
    const jobId = "900002";
    await seedSubmission({ employerId: "800002", jobId });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Blocked", { status: 403 }))
    );

    const response = await submit(jobId);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: "Serious Teachers login page returned 403",
      ok: false,
    });
    expect(
      await env.DB.prepare(
        `SELECT j.status job_status,d.status draft_status
         FROM jobs j JOIN application_drafts d ON d.job_id=j.id WHERE j.id=?`
      )
        .bind(jobId)
        .first()
    ).toEqual({ draft_status: "approved", job_status: "failed" });
  });

  it("reconciles a previous send without posting a duplicate", async () => {
    const jobId = "900003";
    const employerId = "800003";
    await seedSubmission({
      draftStatus: "approved",
      employerId,
      jobId,
      jobStatus: "failed",
    });
    const board = mockSeriousTeachers({
      appliedDate: "13 July 2026",
      employerId,
      jobId,
    });

    const response = await submit(jobId);

    expect(response.status).toBe(200);
    expect(board.submissionPostCount()).toBe(0);
    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE id=?")
        .bind(jobId)
        .first()
    ).toEqual({ status: "applied" });
  });
});
