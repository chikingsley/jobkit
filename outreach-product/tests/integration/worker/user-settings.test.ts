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
  it("upgrades version 4 work history into safe application evidence", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "legacy-profile@example.test"
    );
    const legacyProfile = {
      availability: "",
      citizenship: "United States",
      credentials: [],
      currentLocation: "Phoenix, Arizona",
      education: [],
      email: "legacy-profile@example.test",
      experienceLabel: "",
      fields: [],
      fullName: "Legacy Profile",
      introduction: "",
      languages: [],
      phone: "",
      preferredName: "Legacy",
      profileReviewNotes: [],
      subjectQualifications: [],
      workAuthorization: [],
      workExperience: [
        {
          current: false,
          employer: "Example Local School",
          endDate: "2024",
          highlights: ["Taught adult English learners."],
          location: "Las Vegas, Nevada",
          startDate: "2022",
          title: "English Teacher",
        },
      ],
    };
    await testEnv.DB.prepare(
      `INSERT INTO user_profiles
        (id,user_id,profile_json,updated_at,schema_version)
       VALUES (?,?,?,?,4)`
    )
      .bind(
        crypto.randomUUID(),
        userId,
        JSON.stringify(legacyProfile),
        "2026-07-21T00:00:00.000Z"
      )
      .run();

    const response = await exports.default.fetch(
      "https://outreach.test/api/profile",
      { headers: { cookie } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        workExperience: [
          {
            employer: "Example Local School",
            messageAttribution: "describe",
            messageHighlights: ["Taught adult English learners."],
          },
        ],
      },
    });
  });

  it("stores a valid browser time zone and rejects invalid names", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "time-zone@example.test"
    );
    const saved = await exports.default.fetch(
      "https://outreach.test/api/time-zone",
      {
        body: JSON.stringify({ timeZone: "America/Phoenix" }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    const rejected = await exports.default.fetch(
      "https://outreach.test/api/time-zone",
      {
        body: JSON.stringify({ timeZone: "Mars/Olympus_Mons" }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(saved.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(
      await testEnv.DB.prepare(
        "SELECT time_zone FROM user_time_zones WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ time_zone: "America/Phoenix" });
  });

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
