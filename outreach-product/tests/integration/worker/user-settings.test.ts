import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("candidate application settings", () => {
  it("creates explicit attachment presets without treating missing files as qualifications", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "document-packets@example.test"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/document-packets",
      { headers: { cookie } }
    );
    const body = (await response.json()) as {
      packets: Array<{
        isDefault: boolean;
        missingCategories: string[];
        slug: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.packets).toEqual([
      expect.objectContaining({
        isDefault: true,
        missingCategories: ["resume", "degree", "tefl"],
        slug: "english-teaching-core",
      }),
      expect.objectContaining({
        isDefault: false,
        missingCategories: ["resume", "degree", "tefl", "passport", "photo"],
        slug: "visa-market",
      }),
    ]);
    expect(
      await testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM user_document_packets WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ count: 2 });
  });

  it("persists and reverses qualification answers and writing choices", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "candidate-settings@example.test"
    );
    const claim = {
      answer: "yes",
      claimKey: '{"kind":"degree","minimumDegreeLevel":"bachelor"}',
      kind: "degree",
      label: "Bachelor degree",
    };
    const savedClaim = await exports.default.fetch(
      "https://outreach.test/api/qualification-claims",
      {
        body: JSON.stringify(claim),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    const savedStyle = await exports.default.fetch(
      "https://outreach.test/api/message-style",
      {
        body: JSON.stringify({ choice: "a", comparisonId: "opening" }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    const clearedClaim = await exports.default.fetch(
      "https://outreach.test/api/qualification-claims",
      {
        body: JSON.stringify({ ...claim, answer: null }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(savedClaim.status).toBe(200);
    expect(savedStyle.status).toBe(200);
    expect(clearedClaim.status).toBe(200);
    expect(await clearedClaim.json()).toMatchObject({ claim: null });
    expect(
      await testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM user_qualification_claims WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ count: 0 });
    expect(
      await testEnv.DB.prepare(
        "SELECT choice FROM user_message_style_choices WHERE user_id=? AND comparison_id='opening'"
      )
        .bind(userId)
        .first()
    ).toEqual({ choice: "a" });
  });
});
