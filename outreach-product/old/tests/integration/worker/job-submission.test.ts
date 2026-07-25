import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

interface SeedOptions {
  draftStatus?: "approved" | "draft";
  employerId: string;
  jobId: string;
  jobStatus?: "failed" | "review";
  userId: string;
}

async function seedSubmission({
  draftStatus = "draft",
  employerId,
  jobId,
  jobStatus = "review",
  userId,
}: SeedOptions) {
  const timestamp = "2026-07-14T00:00:00.000Z";
  const userJobId = `user-job-${jobId}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO job_listings
       (id,title,company,country,apply_url,employer_id,first_seen_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      jobId,
      "Test teaching role",
      "Test school",
      "Poland",
      `https://www.seriousteachers.com/te2/respond/${jobId}/${employerId}`,
      employerId,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO user_listing_states
       (id,user_id,job_id,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(userJobId, userId, jobId, jobStatus, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO application_routes
       (id,job_id,kind,destination,source_evidence,last_verified_at,status,created_at,updated_at)
       VALUES (?,?,'board_form',?,?,?,'active',?,?)`
    ).bind(
      `route-${jobId}`,
      jobId,
      `https://www.seriousteachers.com/te2/respond/${jobId}/${employerId}`,
      `https://www.seriousteachers.com/job_details/${jobId}/0/`,
      timestamp,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO application_drafts
       (id,user_job_id,version,message,status,created_at,approved_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      `draft-${jobId}`,
      userJobId,
      1,
      "Hello,\n\nA precise test application.",
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

interface SeriousTeachersMockState {
  submissionPosts: number;
  submitted: boolean;
}

interface SeriousTeachersRequest {
  appliedDate?: string;
  applyUrl: string;
  employerId: string;
  jobId: string;
  method: string;
  state: SeriousTeachersMockState;
  url: string;
}

function loginResponse({ method, url }: SeriousTeachersRequest) {
  if (!url.endsWith("/te2/login")) {
    return null;
  }
  if (method === "GET") {
    return htmlResponse(
      '<input name="__RequestVerificationToken" value="login-token">',
      ["antiforgery=first; Path=/", "ARRAffinity=first; Path=/"]
    );
  }
  return method === "POST"
    ? redirectResponse(["session=active; Path=/"])
    : null;
}

function panelResponse({
  appliedDate,
  employerId,
  jobId,
  state,
  url,
}: SeriousTeachersRequest) {
  if (!url.includes("/te2/seriousteachers_panel/")) {
    return null;
  }
  const date = appliedDate ?? (state.submitted ? "14 July 2026" : null);
  return htmlResponse(
    date
      ? `<button data-bs-target="#_${jobId}${employerId}">last applied on ${date}</button>`
      : "<main>No application yet</main>"
  );
}

function applicationResponse({
  applyUrl,
  method,
  state,
  url,
}: SeriousTeachersRequest) {
  if (url !== applyUrl) {
    return null;
  }
  if (method === "GET") {
    return htmlResponse(
      '<input name="__RequestVerificationToken" value="apply-token"><input name="Teacher.Abroad" value="true"><input name="Teacher.euteacher" value="false">'
    );
  }
  if (method !== "POST") {
    return null;
  }
  state.submitted = true;
  state.submissionPosts += 1;
  return redirectResponse();
}

function seriousTeachersResponse(request: SeriousTeachersRequest) {
  const response =
    loginResponse(request) ??
    panelResponse(request) ??
    applicationResponse(request);
  if (response) {
    return response;
  }
  throw new Error(`Unexpected request: ${request.method} ${request.url}`);
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
  const state: SeriousTeachersMockState = {
    submissionPosts: 0,
    submitted: false,
  };
  const userAgents: (string | null)[] = [];
  const applyUrl = `https://www.seriousteachers.com/te2/respond/${jobId}/${employerId}`;
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    userAgents.push(headers.get("user-agent"));
    return seriousTeachersResponse({
      appliedDate,
      applyUrl,
      employerId,
      jobId,
      method,
      state,
      url,
    });
  });
  vi.stubGlobal("fetch", mock);
  return {
    submissionPostCount: () => state.submissionPosts,
    userAgents: () => userAgents,
  };
}

function submit(jobId: string, cookie: string) {
  return exports.default.fetch(
    `https://outreach.test/api/jobs/${jobId}/submit`,
    {
      body: JSON.stringify({ draftId: `draft-${jobId}` }),
      headers: { "content-type": "application/json", cookie },
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
    const { cookie, userId } = await createAuthenticatedUser(
      "submission-one@example.test"
    );
    await seedSubmission({ employerId, jobId, userId });
    const board = mockSeriousTeachers({ employerId, jobId });

    const response = await submit(jobId, cookie);

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
        `SELECT uj.status job_status,d.status draft_status,d.submitted_at
         FROM user_listing_states uj
         JOIN application_drafts d ON d.user_job_id=uj.id
         WHERE uj.job_id=?`
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
    const { cookie, userId } = await createAuthenticatedUser(
      "submission-two@example.test"
    );
    await seedSubmission({ employerId: "800002", jobId, userId });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Blocked", { status: 403 }))
    );

    const response = await submit(jobId, cookie);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: "Serious Teachers login page returned 403",
      ok: false,
    });
    expect(
      await env.DB.prepare(
        `SELECT uj.status job_status,d.status draft_status
         FROM user_listing_states uj
         JOIN application_drafts d ON d.user_job_id=uj.id
         WHERE uj.job_id=?`
      )
        .bind(jobId)
        .first()
    ).toEqual({ draft_status: "approved", job_status: "failed" });
  });

  it("reconciles a pre-existing board application without claiming this draft was sent", async () => {
    const jobId = "900003";
    const employerId = "800003";
    const { cookie, userId } = await createAuthenticatedUser(
      "submission-three@example.test"
    );
    await seedSubmission({
      draftStatus: "approved",
      employerId,
      jobId,
      jobStatus: "failed",
      userId,
    });
    const board = mockSeriousTeachers({
      appliedDate: "13 July 2026",
      employerId,
      jobId,
    });

    const response = await submit(jobId, cookie);

    expect(response.status).toBe(200);
    expect(board.submissionPostCount()).toBe(0);
    expect(
      await env.DB.prepare(
        `SELECT uj.status job_status,d.status draft_status,d.submitted_at
         FROM user_listing_states uj
         JOIN application_drafts d ON d.user_job_id=uj.id
         WHERE uj.job_id=?`
      )
        .bind(jobId)
        .first()
    ).toEqual({
      draft_status: "approved",
      job_status: "applied",
      submitted_at: null,
    });
  });
});
