import { z } from "zod";

const ExchangeRatesSchema = z.object({
  rates: z.record(z.string(), z.number()).optional(),
  time_last_update_utc: z.string().optional(),
});

const UniversityRowsSchema = z.array(z.object({ name: z.string().optional() }));

const MapboxResponseSchema = z.object({
  features: z
    .array(
      z.object({
        properties: z
          .object({
            full_address: z.string().optional(),
            name: z.string().optional(),
            name_preferred: z.string().optional(),
            place_formatted: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

export async function fetchExchangeRates() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cf: { cacheEverything: true, cacheTtl: 21_600 },
  });
  if (!response.ok) {
    throw new Error("Exchange rates unavailable");
  }
  const data = ExchangeRatesSchema.parse(await response.json());
  return {
    base: "USD",
    rates: data.rates ?? {},
    updatedAt: data.time_last_update_utc ?? null,
  };
}

export async function searchUniversities(query: string, country: string) {
  const url = new URL("http://universities.hipolabs.com/search");
  url.searchParams.set("name", query);
  if (country) {
    url.searchParams.set("country", country);
  }
  try {
    const response = await fetch(url, {
      cf: { cacheEverything: true, cacheTtl: 86_400 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [query];
    }
    const rows = UniversityRowsSchema.parse(await response.json());
    return [
      ...new Set(
        rows
          .map(({ name }) => name?.trim())
          .filter((name): name is string => Boolean(name))
      ),
    ].slice(0, 20);
  } catch {
    return [query];
  }
}

export async function searchLocations(query: string, accessToken?: string) {
  if (!accessToken) {
    return [query];
  }
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "8");
  url.searchParams.set("types", "place,locality,district,region,country");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return [query];
    }
    const data = MapboxResponseSchema.parse(await response.json());
    const locations = (data.features ?? [])
      .map(({ properties }) => {
        if (!properties) {
          return "";
        }
        if (properties.full_address) {
          return properties.full_address;
        }
        const name = properties.name_preferred ?? properties.name ?? "";
        return [name, properties.place_formatted].filter(Boolean).join(", ");
      })
      .filter((location): location is string => Boolean(location));
    return [...new Set(locations)].slice(0, 8);
  } catch {
    return [query];
  }
}
