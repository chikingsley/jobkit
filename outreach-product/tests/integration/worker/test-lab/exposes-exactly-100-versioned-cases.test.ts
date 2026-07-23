import { applyD1Migrations } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedUser } from ".././auth";
import { agentPost, pairAgent, sessionRequest, testEnv } from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("Test Lab", () => {
  it("exposes exactly 100 versioned cases only to operators", async () => {
    const unauthorized = await exports.default.fetch(
      "https://outreach.test/api/test-lab"
    );
    const member = await createAuthenticatedUser(
      "test-lab-member@example.test",
      "member"
    );
    const forbidden = await sessionRequest("/api/test-lab", member.cookie);
    const { cookie } = await createAuthenticatedUser(
      "test-lab-corpus@example.test"
    );
    const response = await sessionRequest("/api/test-lab", cookie);
    const payload = (await response.json()) as {
      cases: Array<{ id: string; version: string }>;
      corpusVersion: string;
    };

    expect(unauthorized.status).toBe(401);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      message: "Operator access is required",
      ok: false,
    });
    expect(response.status).toBe(200);
    expect(payload.cases).toHaveLength(100);
    expect(new Set(payload.cases.map((testCase) => testCase.id)).size).toBe(
      100
    );
    expect(
      payload.cases.every(
        (testCase) => testCase.version === payload.corpusVersion
      )
    ).toBe(true);
  });

  it("records a reversible human adjudication for a versioned disagreement", async () => {
    const { cookie } = await createAuthenticatedUser(
      "test-lab-adjudication@example.test"
    );
    const initial = await sessionRequest(
      "/api/test-lab/classification-review",
      cookie
    );
    const initialPayload = (await initial.json()) as {
      cases: Array<{ itemId: string; labels: Array<{ label: string }> }>;
      corpusVersion: string;
      summary: { decided: number; remaining: number; total: number };
    };
    const [reviewCase] = initialPayload.cases;
    if (!reviewCase) {
      throw new Error("Classification review corpus was empty");
    }

    expect(initial.status).toBe(200);
    expect(initialPayload.cases).toHaveLength(23);
    expect(initialPayload.summary).toEqual({
      decided: 0,
      remaining: 23,
      total: 23,
    });
    expect(new Set(reviewCase.labels.map((item) => item.label)).size).toBe(2);

    const saved = await sessionRequest(
      `/api/test-lab/classification-review/${encodeURIComponent(reviewCase.itemId)}`,
      cookie,
      "PUT",
      { label: "unclear", notes: "Human review of both blind passes" }
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      adjudication: {
        itemId: reviewCase.itemId,
        label: "unclear",
        notes: "Human review of both blind passes",
      },
    });

    const updated = await sessionRequest(
      "/api/test-lab/classification-review",
      cookie
    );
    await expect(updated.json()).resolves.toMatchObject({
      summary: { decided: 1, remaining: 22, total: 23 },
    });

    const cleared = await sessionRequest(
      `/api/test-lab/classification-review/${encodeURIComponent(reviewCase.itemId)}`,
      cookie,
      "DELETE"
    );
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      result: { itemId: reviewCase.itemId },
    });

    const restored = await sessionRequest(
      "/api/test-lab/classification-review",
      cookie
    );
    await expect(restored.json()).resolves.toMatchObject({
      summary: { decided: 0, remaining: 23, total: 23 },
    });
  });

  it("queues, claims, validates, and scores a Codex evaluation", async () => {
    const { cookie } = await createAuthenticatedUser(
      "test-lab-codex@example.test"
    );
    const queued = await sessionRequest("/api/test-lab/runs", cookie, "POST", {
      caseId: "classification-01",
      variant: "codex",
    });
    const queuedPayload = (await queued.json()) as {
      run: { id: string; status: string };
    };
    expect(queued.status).toBe(202);
    expect(queuedPayload.run.status).toBe("queued");

    const token = await pairAgent(cookie);
    const claim = await agentPost("/api/agent-tasks/claim", token, {
      runnerVersion: "codex-cli test",
    });
    const claimPayload = (await claim.json()) as {
      task: {
        model: string;
        leaseToken: string;
        prompt: string;
        runId: string;
        taskType: string;
      };
    };
    expect(claimPayload.task).toMatchObject({
      model: "gpt-5.6-luna",
      taskType: "test_lab.evaluate",
    });
    expect(claimPayload.task.prompt).toContain("<case-input>");
    expect(claimPayload.task.prompt).toContain("untrusted source material");

    const completed = await agentPost(
      `/api/agent-tasks/${claimPayload.task.runId}/complete`,
      token,
      {
        leaseToken: claimPayload.task.leaseToken,
        output: { label: "english_teaching" },
      }
    );
    expect(completed.status).toBe(200);

    const run = await sessionRequest(
      `/api/test-lab/runs/${queuedPayload.run.id}`,
      cookie
    );
    await expect(run.json()).resolves.toMatchObject({
      run: {
        metrics: { exact: true, passed: true, score: 1 },
        output: { label: "english_teaching" },
        provider: "codex",
        status: "completed",
      },
    });
  });

  it("records a schema-validated Jina classification without queuing Codex", async () => {
    const { cookie } = await createAuthenticatedUser(
      "test-lab-jina@example.test"
    );
    const provider = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.resolve(
        Response.json({
          data: [
            {
              index: 0,
              prediction: "english_teaching",
              predictions: [],
              score: 0.98,
            },
          ],
          usage: { total_tokens: 12 },
        })
      )
    );
    try {
      const response = await sessionRequest(
        "/api/test-lab/runs",
        cookie,
        "POST",
        { caseId: "classification-01", variant: "jina" }
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        run: {
          metrics: { exact: true, passed: true, score: 1 },
          model: "jina-embeddings-v3",
          output: { label: "english_teaching" },
          provider: "jina",
          status: "completed",
        },
      });
      expect(provider).toHaveBeenCalledWith(
        "https://api.jina.ai/v1/classify",
        expect.objectContaining({ method: "POST" })
      );
      const request = provider.mock.calls[0]?.[1];
      expect(JSON.parse(String(request?.body))).toMatchObject({
        model: "jina-embeddings-v3",
      });
    } finally {
      provider.mockRestore();
    }
  });

  it("records Jina as an intermediate and lets Codex correct a hybrid result", async () => {
    const { cookie } = await createAuthenticatedUser(
      "test-lab-hybrid@example.test"
    );
    const provider = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.resolve(
        Response.json({
          data: [
            {
              index: 0,
              prediction: "unclear",
              predictions: [],
              score: 0.51,
            },
          ],
          usage: { total_tokens: 12 },
        })
      )
    );
    let token = "";
    try {
      const queued = await sessionRequest(
        "/api/test-lab/runs",
        cookie,
        "POST",
        { caseId: "classification-01", variant: "hybrid" }
      );
      const queuedPayload = (await queued.json()) as {
        run: { id: string; intermediate: unknown };
      };
      expect(queued.status).toBe(202);
      expect(queuedPayload.run.intermediate).toMatchObject({
        label: "unclear",
      });

      token = await pairAgent(cookie);
      const claim = await agentPost("/api/agent-tasks/claim", token, {
        runnerVersion: "codex-cli test",
      });
      const claimPayload = (await claim.json()) as {
        task: {
          leaseToken: string;
          model: string;
          prompt: string;
          runId: string;
        };
      };
      expect(claimPayload.task.model).toBe("gpt-5.6-luna");
      expect(claimPayload.task.prompt).toContain("<jina-result>");
      await agentPost(
        `/api/agent-tasks/${claimPayload.task.runId}/complete`,
        token,
        {
          leaseToken: claimPayload.task.leaseToken,
          output: { label: "english_teaching" },
        }
      );
      const run = await sessionRequest(
        `/api/test-lab/runs/${queuedPayload.run.id}`,
        cookie
      );
      await expect(run.json()).resolves.toMatchObject({
        run: {
          intermediate: { label: "unclear" },
          metrics: {
            exact: true,
            passed: true,
            score: 1,
          },
          output: { label: "english_teaching" },
          provider: "jina+codex",
          status: "completed",
        },
      });
    } finally {
      provider.mockRestore();
    }
  });

  it("keeps unsupported Jina adapters explicit", async () => {
    const { cookie } = await createAuthenticatedUser(
      "test-lab-unsupported@example.test"
    );
    const response = await sessionRequest(
      "/api/test-lab/runs",
      cookie,
      "POST",
      { caseId: "extraction-01", variant: "jina" }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: "jina is not supported for extraction",
      ok: false,
    });
  });
});
