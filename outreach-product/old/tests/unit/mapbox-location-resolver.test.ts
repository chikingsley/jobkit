import { describe, expect, test } from "bun:test";
import {
  createMapboxPermanentLocationResolver,
  LocationProviderError,
} from "../../worker/services/public-projection/mapbox-location-resolver";

const fixture = {
  attribution: "Mapbox fixture",
  features: [
    {
      geometry: { coordinates: [44.8015, 41.6938], type: "Point" },
      id: "tbilisi-feature",
      properties: {
        context: {
          country: {
            country_code: "ge",
            mapbox_id: "georgia",
            name: "Georgia",
          },
        },
        feature_type: "place",
        full_address: "Tbilisi, Georgia",
        mapbox_id: "tbilisi",
        match_code: { confidence: "exact" },
        name: "Tbilisi",
      },
      type: "Feature",
    },
  ],
  type: "FeatureCollection",
};

describe("permanent Mapbox location resolver", () => {
  test("pins permanent v6 parameters and excludes credentials from evidence", async () => {
    const requests: URL[] = [];
    const resolver = createMapboxPermanentLocationResolver(
      "private-token",
      (input) => {
        requests.push(new URL(input.toString()));
        return Promise.resolve(Response.json(fixture));
      }
    );

    const result = await resolver.resolve({
      bbox: [40, 40, 46, 44],
      countryCode: "GE",
      literalLabel: "Tbilisi, Georgia",
      semanticKind: "city",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("access_token")).toBe("private-token");
    expect(result.requestParameters).toEqual({
      autocomplete: "false",
      bbox: "40,40,46,44",
      country: "ge",
      language: "en",
      limit: "10",
      permanent: "true",
      q: "Tbilisi, Georgia",
      types: "place,locality,district",
      worldview: "us",
    });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(result.requestHash).toHaveLength(64);
    expect(result.responseHash).toHaveLength(64);
  });

  test("fails closed when permanent provider credentials are unavailable", async () => {
    const resolver = createMapboxPermanentLocationResolver(undefined);
    try {
      await resolver.resolve({
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      });
      throw new Error("Expected a provider credential failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LocationProviderError);
      expect((error as LocationProviderError).code).toBe(
        "location_provider_auth"
      );
    }
  });

  test("rejects provider payloads above the immutable evidence bound", async () => {
    const resolver = createMapboxPermanentLocationResolver(
      "private-token",
      () =>
        Promise.resolve(
          new Response("{}", {
            headers: { "content-length": "1000001" },
          })
        )
    );
    await expect(
      resolver.resolve({
        countryCode: null,
        literalLabel: "Anywhere",
        semanticKind: "unknown",
      })
    ).rejects.toMatchObject({ code: "location_provider_schema" });
  });

  test("rejects invalid forward queries before performing a fetch", async () => {
    let requests = 0;
    const resolver = createMapboxPermanentLocationResolver(
      "private-token",
      () => {
        requests += 1;
        return Promise.resolve(Response.json(fixture));
      }
    );
    await Promise.all(
      [
        "a;drop",
        "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one",
        "x".repeat(257),
      ].map((literalLabel) =>
        expect(
          resolver.resolve({
            countryCode: "GE",
            literalLabel,
            semanticKind: "city",
          })
        ).rejects.toMatchObject({ code: "location_provider_schema" })
      )
    );
    expect(requests).toBe(0);
  });

  test("rejects invalid query and response coordinate bounds", async () => {
    const resolver = createMapboxPermanentLocationResolver(
      "private-token",
      () =>
        Promise.resolve(
          Response.json({
            ...fixture,
            features: [
              {
                ...fixture.features[0],
                bbox: [45, 42, 44, 41],
                geometry: { coordinates: [181, 41.6938], type: "Point" },
              },
            ],
          })
        )
    );
    await expect(
      resolver.resolve({
        bbox: [45, 42, 44, 41],
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      })
    ).rejects.toMatchObject({ code: "location_provider_schema" });

    await expect(
      createMapboxPermanentLocationResolver("private-token", () =>
        Promise.resolve(
          Response.json({
            ...fixture,
            features: [
              {
                ...fixture.features[0],
                geometry: { coordinates: [181, 41.6938], type: "Point" },
              },
            ],
          })
        )
      ).resolve({
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      })
    ).rejects.toMatchObject({ code: "location_provider_schema" });
  });
});
