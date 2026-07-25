import type { ResolvedJobLocation } from "../../src/features/jobs/types";

const MAX_STATIC_MAP_BYTES = 5_000_000;

export class JobMapError extends Error {
  readonly status: 404 | 502 | 503;

  constructor(
    message: string,
    status: 404 | 502 | 503,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.status = status;
  }
}

export async function fetchStaticJobMap(
  location: ResolvedJobLocation,
  accessToken: string | undefined,
  fetcher: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = fetch
) {
  if (!accessToken) {
    throw new JobMapError("The map service is not configured", 503);
  }
  let upstream: Response;
  try {
    upstream = await fetcher(staticJobMapUrl(location, accessToken), {
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
    });
  } catch (cause) {
    const error = new JobMapError("The map service could not be reached", 502);
    error.cause = cause;
    throw error;
  }
  if (!upstream.ok) {
    throw new JobMapError("The map service did not return an image", 502);
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (
    !contentType.startsWith("image/") ||
    (declaredLength > 0 && declaredLength > MAX_STATIC_MAP_BYTES)
  ) {
    throw new JobMapError("The map service returned an invalid image", 502);
  }
  return new Response(upstream.body, {
    headers: {
      "cache-control": "private, max-age=43200",
      "content-type": contentType,
    },
  });
}

export function staticJobMapUrl(
  location: ResolvedJobLocation,
  accessToken: string
) {
  const longitude = rounded(location.longitude, -180, 180);
  const latitude = rounded(location.latitude, -85.0511, 85.0511);
  const overlay = `pin-s+0891b2(${longitude},${latitude})`;
  const url = new URL(
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}/${longitude},${latitude},11/800x500@2x`
  );
  url.searchParams.set("access_token", accessToken);
  return url;
}

function rounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value)).toFixed(6);
}
