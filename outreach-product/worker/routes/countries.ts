import {
  CountryCampaignLaunchSchema,
  CountryCampaignTargetDecisionSchema,
  CountrySweepRequestSchema,
} from "../../src/features/countries/schema";
import type { JobKitApp } from "../app-types";
import {
  CountryMarketError,
  createCountrySweep,
  decideCountryCampaignTarget,
  launchCountryCampaign,
  listCountryMarkets,
  readCountryCampaign,
  readCountryDetail,
} from "../services/country-markets";

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;

export function registerCountryRoutes(app: JobKitApp) {
  app.get("/api/countries", async (c) => {
    const countries = await listCountryMarkets(c.env.DB, c.get("user").id);
    return c.json({ countries });
  });

  app.get("/api/countries/:countryCode", async (c) => {
    const countryCode = normalizedCountryCode(c.req.param("countryCode"));
    const country = await readCountryDetail(
      c.env.DB,
      c.get("user").id,
      countryCode
    );
    return c.json({ country });
  });

  app.post("/api/countries/:countryCode/sweeps", async (c) => {
    const countryCode = normalizedCountryCode(c.req.param("countryCode"));
    const request = CountrySweepRequestSchema.parse(await c.req.json());
    const sweep = await createCountrySweep(
      c.env.DB,
      c.get("user").id,
      countryCode,
      request
    );
    return c.json({
      message: sweep.reused
        ? "The active country refresh is still running"
        : "Country refresh queued",
      ok: true,
      sweep,
    });
  });

  app.post("/api/countries/:countryCode/campaigns", async (c) => {
    const countryCode = normalizedCountryCode(c.req.param("countryCode"));
    const launch = CountryCampaignLaunchSchema.parse(await c.req.json());
    const campaign = await launchCountryCampaign(
      c.env.DB,
      c.get("user").id,
      countryCode,
      launch
    );
    return c.json({
      campaign,
      message:
        launch.executionMode === "research_only"
          ? "Country research campaign queued"
          : `Campaign created with ${campaign.targetCount} current targets`,
      ok: true,
    });
  });

  app.get("/api/country-campaigns/:campaignId", async (c) => {
    const campaign = await readCountryCampaign(
      c.env.DB,
      c.get("user").id,
      c.req.param("campaignId")
    );
    return c.json({ campaign });
  });

  app.patch(
    "/api/country-campaigns/:campaignId/targets/:targetId",
    async (c) => {
      const decision = CountryCampaignTargetDecisionSchema.parse(
        await c.req.json()
      );
      const campaign = await decideCountryCampaignTarget(
        c.env.DB,
        c.get("user").id,
        c.req.param("campaignId"),
        c.req.param("targetId"),
        decision
      );
      return c.json({ campaign, message: "Campaign target updated", ok: true });
    }
  );
}

function normalizedCountryCode(value: string) {
  const countryCode = value.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(countryCode)) {
    throw new CountryMarketError("Country code must contain two letters", 400);
  }
  return countryCode;
}
