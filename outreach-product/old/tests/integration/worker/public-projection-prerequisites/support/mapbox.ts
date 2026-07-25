import { advancePublicProjectionRuns } from "../../../../../worker/services/public-projection/advancement";
import type { PermanentLocationResponse } from "../../../../../worker/services/public-projection/mapbox-location-resolver";
import { testEnv, timestamp } from "./model";

export function mapboxTbilisiFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.8015, 41.6938], type: "Point" },
        id: "dXJuOm1ieHBsYzp0YmlsaXNp",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "dXJuOm1ieHBsYzpnZW9yZ2lh",
              name: "Georgia",
            },
          },
          coordinates: { latitude: 41.6938, longitude: 44.8015 },
          feature_type: "place",
          full_address: "Tbilisi, Georgia",
          mapbox_id: "dXJuOm1ieHBsYzp0YmlsaXNp",
          match_code: { confidence: "exact" },
          name: "Tbilisi",
          place_formatted: "Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

export function mapboxGeorgiaFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        bbox: [39.9, 41, 46.8, 43.7],
        geometry: { coordinates: [43.5, 42.1], type: "Point" },
        id: "georgia-feature",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
          },
          feature_type: "country",
          full_address: "Georgia",
          mapbox_id: "georgia",
          match_code: { confidence: "exact" },
          name: "Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

export function mapboxChinaFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        bbox: [73.5, 18.2, 134.8, 53.6],
        geometry: { coordinates: [104.2, 35.9], type: "Point" },
        id: "china-feature",
        properties: {
          context: {
            country: {
              country_code: "cn",
              mapbox_id: "china",
              name: "People's Republic of China",
            },
          },
          feature_type: "country",
          full_address: "People's Republic of China",
          mapbox_id: "china",
          match_code: { confidence: "exact" },
          name: "People's Republic of China",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

export function mapboxZhangjiajieFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [110.5, 29.1], type: "Point" },
        id: "zhangjiajie-feature",
        properties: {
          context: {
            country: {
              country_code: "cn",
              mapbox_id: "china",
              name: "People's Republic of China",
            },
            place: { mapbox_id: "zhangjiajie", name: "Zhangjiajie" },
            region: { mapbox_id: "hunan", name: "Hunan" },
          },
          feature_type: "place",
          full_address: "Zhangjiajie, Hunan, People's Republic of China",
          mapbox_id: "zhangjiajie",
          match_code: { confidence: "exact" },
          name: "Zhangjiajie",
          place_formatted: "Hunan, People's Republic of China",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

export function mapboxCityFixture(name: string, padding: string) {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.8, 41.7], type: "Point" },
        id: `${name}-feature`,
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
          },
          feature_type: "place",
          full_address: `${name}, Georgia`,
          mapbox_id: `${name}-place`,
          match_code: { confidence: "exact" },
          name,
          place_formatted: "Georgia",
        },
        type: "Feature",
      },
    ],
    padding,
    type: "FeatureCollection",
  };
}

export function mapboxAddressFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.799, 41.7], type: "Point" },
        id: "rustaveli-address-feature",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
            place: { mapbox_id: "tbilisi", name: "Tbilisi" },
          },
          feature_type: "address",
          full_address: "12 Rustaveli Avenue, Tbilisi, Georgia",
          mapbox_id: "rustaveli-address",
          match_code: {
            address_number: "matched",
            confidence: "medium",
            street: "unmatched",
          },
          name: "12 Rustaveli Avenue",
          place_formatted: "Tbilisi, Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

export async function advanceUntilFinalDuplicateComplete() {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: D3 intentionally advances one durable page per invocation.
    const result = await advancePublicProjectionRuns(testEnv.DB);
    if (
      result &&
      "finalDuplicateState" in result &&
      result.finalDuplicateState === "complete"
    ) {
      return result;
    }
  }
  throw new Error("The durable final duplicate drain exceeded its page budget");
}

export function permanentFixtureResponse(
  fixture: ReturnType<
    | typeof mapboxCityFixture
    | typeof mapboxAddressFixture
    | typeof mapboxChinaFixture
    | typeof mapboxGeorgiaFixture
    | typeof mapboxTbilisiFixture
    | typeof mapboxZhangjiajieFixture
  >,
  label: string
) {
  return {
    features: fixture.features,
    normalizedResponse: fixture,
    provider: "mapbox-geocoding-v6",
    queriedAt: timestamp,
    requestHash: "a".repeat(64),
    requestParameters: {
      autocomplete: "false",
      permanent: "true",
      q: label,
    },
    responseHash: "b".repeat(64),
  } as unknown as PermanentLocationResponse;
}
