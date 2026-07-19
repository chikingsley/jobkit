import { CountrySweepRequestSchema } from "../../src/features/countries/schema";
import type { JobKitApp } from "../app-types";
import {
  CountryMarketError,
  createCountrySweep,
  listCountryMarkets,
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
}

function normalizedCountryCode(value: string) {
  const countryCode = value.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(countryCode)) {
    throw new CountryMarketError("Country code must contain two letters", 400);
  }
  return countryCode;
}
