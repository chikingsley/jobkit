import { describe, expect, test } from "bun:test";
import type { ResolvedJobLocation } from "../../src/features/jobs/types";
import {
  fetchStaticJobMap,
  JobMapError,
  staticJobMapUrl,
} from "../../worker/services/job-map";

const location: ResolvedJobLocation = {
  bounds: null,
  coordinateKind: "centroid",
  countryCode: "GE",
  displayName: "Tbilisi, Georgia",
  latitude: 41.7151,
  longitude: 44.8271,
  provider: "mapbox",
  providerPlaceId: "place.tbilisi",
};

describe("job map image", () => {
  test("builds a bounded Mapbox static-image request", () => {
    const url = staticJobMapUrl(location, "private-token");
    expect(url.origin).toBe("https://api.mapbox.com");
    expect(url.pathname).toContain("44.827100,41.715100,11/800x500@2x");
    expect(url.searchParams.get("access_token")).toBe("private-token");
  });

  test("proxies only a successful image response", async () => {
    const response = await fetchStaticJobMap(location, "private-token", () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        })
      )
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );

    await expect(
      fetchStaticJobMap(location, "private-token", () =>
        Promise.resolve(
          new Response("upstream error", {
            headers: { "content-type": "text/plain" },
            status: 502,
          })
        )
      )
    ).rejects.toBeInstanceOf(JobMapError);
  });
});
