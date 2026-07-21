import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultPreferences } from "../../../src/features/preferences/schema";
import type { Profile } from "../../../src/features/profile/schema";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("Codex profile imports", () => {
  it("queues an uploaded resume and applies the schema-validated agent result", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "profile-agent@example.test",
      "member"
    );
    const resume = `Alex Teacher
alex@example.test

English teacher with five years of classroom experience.

Teacher, Example School, 2021 to Present
Taught English to adult and teenage learners in group classes.`;
    const token = await pairAgent(cookie);
    const upload = await exports.default.fetch(
      "https://outreach.test/api/profile-imports",
      {
        body: resume,
        headers: {
          "content-length": String(new TextEncoder().encode(resume).byteLength),
          "content-type": "text/plain",
          cookie,
          "x-jobkit-filename": "resume.txt",
        },
        method: "PUT",
      }
    );
    const uploadPayload = (await upload.json()) as {
      id: string;
      status: string;
    };
    expect(upload.status).toBe(202);
    expect(uploadPayload.status).toBe("processing");

    const claim = await agentPost("/api/agent-tasks/claim", token, {
      runnerVersion: "codex-cli test",
    });
    const claimPayload = (await claim.json()) as {
      task: { runId: string; taskType: string; webSearch: string };
    };
    expect(claimPayload.task).toMatchObject({
      taskType: "profile.import",
      webSearch: "disabled",
    });

    const emptyText = { confidence: "low", evidence: "", value: "" };
    const complete = await agentPost(
      `/api/agent-tasks/${claimPayload.task.runId}/complete`,
      token,
      {
        output: {
          citizenship: emptyText,
          credentials: [],
          currentLocation: emptyText,
          education: [],
          email: {
            confidence: "high",
            evidence: "alex@example.test",
            value: "alex@example.test",
          },
          experienceLabel: emptyText,
          fullName: {
            confidence: "high",
            evidence: "Alex Teacher",
            value: "Alex Teacher",
          },
          introduction: {
            confidence: "high",
            evidence:
              "English teacher with five years of classroom experience.",
            value: "English teacher with five years of classroom experience.",
          },
          languages: [],
          phone: emptyText,
          reviewNotes: [],
          skills: [],
          subjectQualifications: [
            {
              confidence: "high",
              evidence:
                "Taught English to adult and teenage learners in group classes.",
              value: "English",
            },
          ],
          workExperience: [
            {
              confidence: "high",
              current: true,
              employer: "Example School",
              endDate: "Present",
              evidence: "Teacher, Example School, 2021 to Present",
              highlights: [
                "Taught English to adult and teenage learners in group classes.",
              ],
              location: "",
              startDate: "2021",
              title: "Teacher",
            },
          ],
        },
      }
    );
    expect(complete.status).toBe(200);

    const onboarding = await exports.default.fetch(
      "https://outreach.test/api/onboarding",
      { headers: { cookie } }
    );
    const onboardingPayload = (await onboarding.json()) as {
      documents: Array<{ category: string; filename: string }>;
      profile: Profile;
      profileImport: { id: string; status: string };
    };
    expect(onboardingPayload).toMatchObject({
      documents: [
        expect.objectContaining({ category: "resume", filename: "resume.txt" }),
      ],
      profile: {
        email: "alex@example.test",
        fullName: "Alex Teacher",
        workExperience: [
          expect.objectContaining({ employer: "Example School" }),
        ],
      },
      profileImport: {
        id: uploadPayload.id,
        status: "ready",
      },
    });

    const settingsHeaders = {
      "content-type": "application/json",
      cookie,
    };
    const [savedProfile, savedPreferences] = await Promise.all([
      exports.default.fetch("https://outreach.test/api/profile", {
        body: JSON.stringify({
          ...onboardingPayload.profile,
          citizenship: "United States",
          currentLocation: "Phoenix, United States",
        }),
        headers: settingsHeaders,
        method: "PUT",
      }),
      exports.default.fetch("https://outreach.test/api/preferences", {
        body: JSON.stringify(defaultPreferences),
        headers: settingsHeaders,
        method: "PUT",
      }),
    ]);
    expect(savedProfile.status, await savedProfile.clone().text()).toBe(200);
    expect(savedPreferences.status).toBe(200);

    const finished = await exports.default.fetch(
      "https://outreach.test/api/onboarding/complete",
      { headers: { cookie }, method: "POST" }
    );
    expect(finished.status).toBe(200);
    await expect(finished.json()).resolves.toMatchObject({
      completedAt: expect.any(String),
      ok: true,
    });

    const outsider = await createAuthenticatedUser(
      "profile-agent-outsider@example.test",
      "member"
    );
    const outsiderDocuments = await exports.default.fetch(
      "https://outreach.test/api/documents",
      { headers: { cookie: outsider.cookie } }
    );
    await expect(outsiderDocuments.json()).resolves.toEqual({ documents: [] });
    await expect(
      testEnv.DB.prepare(
        "SELECT model_provider,model_id,status FROM profile_imports WHERE id=? AND user_id=?"
      )
        .bind(uploadPayload.id, userId)
        .first()
    ).resolves.toEqual({
      model_id: "gpt-5.6-luna",
      model_provider: "codex",
      status: "ready",
    });
  });
});

async function pairAgent(cookie: string) {
  const pairing = await sessionPost("/api/agent-runner-pairings", cookie, {
    capabilities: ["extraction"],
  });
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli test",
    runnerName: "Profile agent",
  });
  const payload = (await exchange.json()) as { runner: { token: string } };
  return payload.runner.token;
}

function sessionPost(
  path: string,
  cookie: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });
}

function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function agentPost(path: string, token: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}
