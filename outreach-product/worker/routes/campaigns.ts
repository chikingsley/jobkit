import {
  CampaignActionSchema,
  CampaignCreateSchema,
  CampaignFeedbackSchema,
  CampaignTargetDecisionSchema,
} from "../../src/features/campaigns/schema";
import type { JobKitApp } from "../app-types";
import {
  approveCampaignDispatch,
  queueCampaignDispatchRevision,
} from "../services/campaign-messages";
import {
  beginCampaignCalibration,
  createCampaign,
  decideCampaignTarget,
  listCampaigns,
  listCampaignTargets,
  readCampaign,
  readCampaignSetup,
  updateCampaignStatus,
} from "../services/campaigns";

export function registerCampaignRoutes(app: JobKitApp) {
  app.get("/api/campaigns/setup", async (c) => {
    const setup = await readCampaignSetup(c.env.DB, c.get("user").id);
    return c.json({ setup });
  });

  app.get("/api/campaigns", async (c) => {
    const campaigns = await listCampaigns(c.env.DB, c.get("user").id);
    return c.json({ campaigns });
  });

  app.post("/api/campaigns", async (c) => {
    const input = CampaignCreateSchema.parse(await c.req.json());
    const campaign = await createCampaign(c.env.DB, c.get("user").id, input);
    return c.json(
      {
        campaign,
        message: `Campaign created with ${campaign.counts.total.toLocaleString()} known targets`,
        ok: true,
      },
      201
    );
  });

  app.get("/api/campaigns/:campaignId", async (c) => {
    const campaign = await readCampaign(
      c.env.DB,
      c.get("user").id,
      c.req.param("campaignId")
    );
    return c.json({ campaign });
  });

  app.get("/api/campaigns/:campaignId/targets", async (c) => {
    const offset = Number(c.req.query("offset") ?? 0);
    const targets = await listCampaignTargets(
      c.env.DB,
      c.get("user").id,
      c.req.param("campaignId"),
      Number.isFinite(offset) ? offset : 0
    );
    return c.json({ targets });
  });

  app.post("/api/campaigns/:campaignId/actions", async (c) => {
    const input = CampaignActionSchema.parse(await c.req.json());
    const campaign =
      input.action === "begin_calibration"
        ? await beginCampaignCalibration(
            c.env.DB,
            c.get("user").id,
            c.req.param("campaignId")
          )
        : await updateCampaignStatus(
            c.env.DB,
            c.get("user").id,
            c.req.param("campaignId"),
            input.action,
            input.reason
          );
    return c.json({ campaign, message: "Campaign updated", ok: true });
  });

  app.patch("/api/campaigns/:campaignId/targets/:targetId", async (c) => {
    const decision = CampaignTargetDecisionSchema.parse(await c.req.json());
    const campaign = await decideCampaignTarget(
      c.env.DB,
      c.get("user").id,
      c.req.param("campaignId"),
      c.req.param("targetId"),
      decision
    );
    return c.json({ campaign, message: "Campaign target updated", ok: true });
  });

  app.post(
    "/api/campaigns/:campaignId/dispatches/:dispatchId/revisions",
    async (c) => {
      const input = CampaignFeedbackSchema.parse(await c.req.json());
      if (input.dispatchId !== c.req.param("dispatchId")) {
        throw new Error("Campaign dispatch did not match the route");
      }
      const taskRequest = await queueCampaignDispatchRevision(
        c.env.DB,
        c.get("user").id,
        c.req.param("campaignId"),
        input.dispatchId,
        input.instruction,
        input.scope
      );
      return c.json(
        {
          message: "Revision queued for the paired Codex runner",
          ok: true,
          taskRequest,
        },
        202
      );
    }
  );

  app.post(
    "/api/campaigns/:campaignId/dispatches/:dispatchId/approve",
    async (c) => {
      await approveCampaignDispatch(
        c.env.DB,
        c.get("user").id,
        c.req.param("campaignId"),
        c.req.param("dispatchId")
      );
      const campaign = await readCampaign(
        c.env.DB,
        c.get("user").id,
        c.req.param("campaignId")
      );
      return c.json({
        campaign,
        message: "Campaign message approved",
        ok: true,
      });
    }
  );
}
