import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { planDueCampaignRuns } from "../../../../worker/services/campaign-scheduler";
import { createAuthenticatedUser } from ".././auth";
import {
  enableSyntheticDelivery,
  seedAneslCampaignJobs,
  sessionPost,
  testEnv,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("campaign lifecycle", () => {
  it("routes the five highest-ranked ANESL positions through one campaign dispatch", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "campaign-anesl@example.test"
    );
    const jobs = await seedAneslCampaignJobs(userId);
    const created = await sessionPost("/api/campaigns", cookie, {
      countryCodes: ["CN"],
      dailyPace: 1,
      firstFiveRequired: false,
      postedTargetPercent: 100,
      stopAfterHumanReplies: 3,
    });
    expect(created.status).toBe(201);
    const createdPayload = (await created.json()) as {
      campaign: { id: string };
    };
    const campaignId = createdPayload.campaign.id;
    await testEnv.DB.batch(
      jobs.map((job, index) =>
        testEnv.DB.prepare(
          `UPDATE campaign_targets SET match_score=?
            WHERE campaign_id=? AND job_id=?`
        ).bind(index + 1, campaignId, job.id)
      )
    );

    const prepared = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "begin_calibration", reason: "" }
    );
    expect(prepared.status).toBe(200);
    await enableSyntheticDelivery(userId);
    const started = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "start", reason: "" }
    );
    expect(started.status).toBe(200);

    await expect(planDueCampaignRuns(testEnv)).resolves.toEqual([
      { campaignId, planned: 1, status: "planned" },
    ]);
    const dispatch = await testEnv.DB.prepare(
      `SELECT id,route_strategy,status
         FROM campaign_dispatches WHERE campaign_id=?`
    )
      .bind(campaignId)
      .first<{ id: string; route_strategy: string; status: string }>();
    expect(dispatch).toMatchObject({
      route_strategy: "anesl_bundle",
      status: "queued",
    });
    if (!dispatch) {
      throw new Error("The ANESL campaign dispatch was not created");
    }
    const selected = await testEnv.DB.prepare(
      `SELECT t.job_id
         FROM campaign_dispatch_targets dt
         JOIN campaign_targets t ON t.id=dt.target_id
        WHERE dt.dispatch_id=? ORDER BY dt.ordinal`
    )
      .bind(dispatch.id)
      .all<{ job_id: string }>();
    expect(selected.results.map((row) => row.job_id)).toEqual(
      jobs
        .slice(-5)
        .reverse()
        .map((job) => job.id)
    );
    const skipped = await testEnv.DB.prepare(
      `SELECT status,hold_reason,COUNT(*) count
         FROM campaign_targets
        WHERE campaign_id=? AND status='skipped'
        GROUP BY status,hold_reason`
    )
      .bind(campaignId)
      .first<{ count: number; hold_reason: string; status: string }>();
    expect(skipped).toEqual({
      count: 2,
      hold_reason:
        "Excluded from this ANESL email after selecting its five highest-ranked positions",
      status: "skipped",
    });
  });
});
