import { countrySweepCityKey } from "../../../src/features/countries/schema";

export async function countrySweepSha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function countrySweepScopeKey(source: string, city: string) {
  if (!city) {
    return source;
  }
  return `${source}:city:${countrySweepCityKey(city)}`;
}

export function requestedSweepCities(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as { cities?: unknown };
    return Array.isArray(parsed.cities)
      ? parsed.cities.filter((city): city is string => typeof city === "string")
      : [];
  } catch {
    return [];
  }
}
