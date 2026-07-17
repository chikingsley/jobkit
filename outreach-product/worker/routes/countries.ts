import {
  CountryCampaignLaunchSchema,
  CountrySweepRequestSchema,
  SweepRunnerTokenCreateSchema,
  SweepTaskClaimSchema,
  SweepTaskCompletionSchema,
  SweepTaskFailureSchema,
} from "../../src/features/countries/schema";
import type { JobKitApp } from "../app-types";
import {
  CountryMarketError,
  createCountrySweep,
  launchCountryCampaign,
  listCountryMarkets,
  readCountryDetail,
} from "../services/country-markets";
import {
  createCountrySweepRunnerToken,
  listCountrySweepRunnerTokens,
  revokeCountrySweepRunnerToken,
} from "../services/country-sweep-runner-auth";
import {
  claimCountrySweepTask,
  completeCountrySweepTask,
  failCountrySweepTask,
} from "../services/country-sweep-tasks";

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;

export function registerCountryRoutes(app: JobKitApp) {
  app.get("/api/country-sweep-runner-tokens", async (c) => {
    const tokens = await listCountrySweepRunnerTokens(
      c.env.DB,
      c.get("user").id
    );
    return c.json({ tokens });
  });

  app.post("/api/country-sweep-runner-tokens", async (c) => {
    const { name } = SweepRunnerTokenCreateSchema.parse(await c.req.json());
    const token = await createCountrySweepRunnerToken(
      c.env.DB,
      c.get("user").id,
      name
    );
    return c.json({
      message: "Runner token created. Copy it now; it will not be shown again.",
      ok: true,
      token,
    });
  });

  app.delete("/api/country-sweep-runner-tokens/:tokenId", async (c) => {
    const revoked = await revokeCountrySweepRunnerToken(
      c.env.DB,
      c.get("user").id,
      c.req.param("tokenId")
    );
    if (!revoked) {
      throw new Error("Runner token was not active");
    }
    return c.json({ message: "Runner token revoked", ok: true });
  });

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

  app.post("/api/country-sweep-tasks/claim", async (c) => {
    const { workerId } = SweepTaskClaimSchema.parse(await c.req.json());
    const task = await claimCountrySweepTask(
      c.env.DB,
      c.get("user").id,
      workerId
    );
    return task
      ? c.json({ ok: true, task })
      : c.json({ message: "No country sweep work is queued", ok: true, task });
  });

  app.post("/api/country-sweep-tasks/:taskId/complete", async (c) => {
    const { output, workerId } = SweepTaskCompletionSchema.parse(
      await c.req.json()
    );
    const result = await completeCountrySweepTask(
      c.env.DB,
      c.get("user").id,
      c.req.param("taskId"),
      workerId,
      output
    );
    return c.json({
      message: "Country sweep task completed",
      ok: true,
      result,
    });
  });

  app.post("/api/country-sweep-tasks/:taskId/fail", async (c) => {
    const { error, workerId } = SweepTaskFailureSchema.parse(
      await c.req.json()
    );
    const result = await failCountrySweepTask(
      c.env.DB,
      c.get("user").id,
      c.req.param("taskId"),
      workerId,
      error
    );
    return c.json({ message: "Country sweep task failed", ok: true, result });
  });
}

function normalizedCountryCode(value: string) {
  const countryCode = value.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(countryCode)) {
    throw new CountryMarketError("Country code must contain two letters", 400);
  }
  return countryCode;
}
