import { z } from "zod";
import { canonicalJson, sha256Hex } from "./hash";

const MAX_MAPBOX_RESPONSE_BYTES = 1_000_000;
const MAX_MAPBOX_QUERY_CODE_POINTS = 256;
const MAX_MAPBOX_QUERY_TOKENS = 20;
const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/iu;

const LongitudeSchema = z.number().min(-180).max(180);
const LatitudeSchema = z.number().min(-90).max(90);
const MapboxBoundingBoxSchema = z
  .tuple([LongitudeSchema, LatitudeSchema, LongitudeSchema, LatitudeSchema])
  .refine(
    ([minimumLongitude, minimumLatitude, maximumLongitude, maximumLatitude]) =>
      minimumLongitude <= maximumLongitude &&
      minimumLatitude <= maximumLatitude,
    { message: "Mapbox bounding boxes must use southwest-northeast order" }
  );

type LocationFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const MapboxContextItemSchema = z
  .object({
    address_number: z.string().optional(),
    country_code: z.string().optional(),
    mapbox_id: z.string().min(1),
    name: z.string().default(""),
    region_code: z.string().optional(),
    region_code_full: z.string().optional(),
    street_name: z.string().optional(),
    translations: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const MapboxFeatureTypeSchema = z.enum([
  "address",
  "country",
  "district",
  "locality",
  "neighborhood",
  "place",
  "postcode",
  "region",
  "street",
]);

const MapboxFeatureSchema = z
  .object({
    bbox: MapboxBoundingBoxSchema.optional(),
    geometry: z.object({
      coordinates: z.tuple([LongitudeSchema, LatitudeSchema]),
      type: z.literal("Point"),
    }),
    id: z.string().min(1),
    properties: z
      .object({
        context: z.record(z.string(), MapboxContextItemSchema).default({}),
        coordinates: z
          .object({
            accuracy: z.string().optional(),
            latitude: LatitudeSchema,
            longitude: LongitudeSchema,
          })
          .passthrough()
          .optional(),
        feature_type: MapboxFeatureTypeSchema,
        full_address: z.string().optional(),
        mapbox_id: z.string().min(1),
        match_code: z.record(z.string(), z.string()).default({}),
        name: z.string().default(""),
        name_preferred: z.string().optional(),
        place_formatted: z.string().optional(),
      })
      .passthrough(),
    type: z.literal("Feature"),
  })
  .passthrough();

const MapboxResponseSchema = z
  .object({
    attribution: z.string().default(""),
    features: z.array(MapboxFeatureSchema).max(10),
    type: z.literal("FeatureCollection"),
  })
  .passthrough();

export type MapboxFeature = z.infer<typeof MapboxFeatureSchema>;
export type MapboxBoundingBox = z.infer<typeof MapboxBoundingBoxSchema>;

export interface PermanentLocationQuery {
  bbox?: MapboxBoundingBox | null;
  countryCode: string | null;
  literalLabel: string;
  semanticKind:
    | "address"
    | "city"
    | "country"
    | "postal_code"
    | "region"
    | "unknown";
}

export interface PermanentLocationResponse {
  features: MapboxFeature[];
  normalizedResponse: {
    attribution: string;
    features: MapboxFeature[];
    type: "FeatureCollection";
  };
  provider: "mapbox-geocoding-v6";
  queriedAt: string;
  requestHash: string;
  requestParameters: Record<string, string>;
  responseHash: string;
}

export interface PermanentLocationResolver {
  resolve: (
    query: PermanentLocationQuery
  ) => Promise<PermanentLocationResponse>;
}

export type LocationProviderErrorCode =
  | "location_provider_auth"
  | "location_provider_rate_limit"
  | "location_provider_schema"
  | "location_provider_timeout"
  | "location_provider_transport"
  | "location_permanent_storage_required";

export class LocationProviderError extends Error {
  readonly code: LocationProviderErrorCode;

  constructor(
    code: LocationProviderErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
    this.name = "LocationProviderError";
  }
}

export function createMapboxPermanentLocationResolver(
  accessToken: string | undefined,
  fetcher: LocationFetcher = fetch
): PermanentLocationResolver {
  return {
    async resolve(query) {
      if (!accessToken?.trim()) {
        throw new LocationProviderError(
          "location_provider_auth",
          "The permanent Mapbox resolver requires an access token"
        );
      }
      const requestParameters = canonicalRequestParameters(query);
      if (requestParameters.permanent !== "true") {
        throw new LocationProviderError(
          "location_permanent_storage_required",
          "Canonical location evidence requires permanent Mapbox results"
        );
      }
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      for (const [key, value] of Object.entries(requestParameters)) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set("access_token", accessToken);
      const queriedAt = new Date().toISOString();
      const response = await fetchMapbox(fetcher, url);
      const raw = await readBoundedJson(response);
      const parsed = parseMapboxResponse(raw);
      const normalizedResponse = JSON.parse(
        JSON.stringify({
          attribution: parsed.attribution,
          features: parsed.features,
          type: "FeatureCollection" as const,
        })
      ) as PermanentLocationResponse["normalizedResponse"];
      if (
        new TextEncoder().encode(canonicalJson(normalizedResponse)).byteLength >
        MAX_MAPBOX_RESPONSE_BYTES
      ) {
        throw new LocationProviderError(
          "location_provider_schema",
          "The normalized Mapbox evidence exceeded the storage size limit"
        );
      }
      return {
        features: parsed.features,
        normalizedResponse,
        provider: "mapbox-geocoding-v6" as const,
        queriedAt,
        requestHash: await sha256Hex(canonicalJson(requestParameters)),
        requestParameters,
        responseHash: await sha256Hex(canonicalJson(normalizedResponse)),
      };
    },
  };
}

async function fetchMapbox(fetcher: LocationFetcher, url: URL) {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    // biome-ignore lint/style/useErrorCause: LocationProviderError forwards ErrorOptions to the native Error constructor.
    throw new LocationProviderError(
      timedOut ? "location_provider_timeout" : "location_provider_transport",
      timedOut
        ? "The permanent Mapbox request timed out"
        : "The permanent Mapbox request failed",
      { cause: error }
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new LocationProviderError(
      "location_provider_auth",
      "Mapbox rejected the permanent resolver credentials"
    );
  }
  if (response.status === 429) {
    throw new LocationProviderError(
      "location_provider_rate_limit",
      "Mapbox rate-limited the permanent resolver"
    );
  }
  if (!response.ok) {
    throw new LocationProviderError(
      "location_provider_transport",
      `Mapbox returned HTTP ${response.status}`
    );
  }
  return response;
}

function parseMapboxResponse(raw: unknown) {
  const parsed = MapboxResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocationProviderError(
      "location_provider_schema",
      "The permanent Mapbox response did not match the v6 schema"
    );
  }
  return parsed.data;
}

function canonicalRequestParameters(query: PermanentLocationQuery) {
  const literalLabel = query.literalLabel.trim();
  const tokenCount = literalLabel.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (
    literalLabel.length === 0 ||
    [...literalLabel].length > MAX_MAPBOX_QUERY_CODE_POINTS ||
    tokenCount > MAX_MAPBOX_QUERY_TOKENS ||
    literalLabel.includes(";")
  ) {
    throw new LocationProviderError(
      "location_provider_schema",
      "The permanent Mapbox query violated the forward-geocoding limits"
    );
  }
  const parameters: Record<string, string> = {
    autocomplete: "false",
    language: "en",
    limit: "10",
    permanent: "true",
    q: literalLabel,
    types: mapboxTypes(query.semanticKind),
    worldview: "us",
  };
  if (query.countryCode) {
    if (!COUNTRY_CODE_PATTERN.test(query.countryCode)) {
      throw new LocationProviderError(
        "location_provider_schema",
        "The permanent Mapbox country filter was invalid"
      );
    }
    parameters.country = query.countryCode.toLowerCase();
  }
  if (query.bbox) {
    const bbox = MapboxBoundingBoxSchema.safeParse(query.bbox);
    if (!bbox.success) {
      throw new LocationProviderError(
        "location_provider_schema",
        "The permanent Mapbox bounding box was invalid"
      );
    }
    parameters.bbox = bbox.data.join(",");
  }
  return Object.fromEntries(
    Object.entries(parameters).sort(([left], [right]) =>
      left.localeCompare(right, "en")
    )
  );
}

function mapboxTypes(kind: PermanentLocationQuery["semanticKind"]) {
  return {
    address: "address",
    city: "place,locality,district",
    country: "country",
    postal_code: "postcode",
    region: "region",
    unknown: "country,region,district,place,locality,postcode,address",
  }[kind];
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MAPBOX_RESPONSE_BYTES
  ) {
    throw new LocationProviderError(
      "location_provider_schema",
      "The permanent Mapbox response exceeded the evidence size limit"
    );
  }
  if (!response.body) {
    throw new LocationProviderError(
      "location_provider_schema",
      "The permanent Mapbox response body was empty"
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let readResult = await reader.read();
  while (!readResult.done) {
    const { value } = readResult;
    size += value.byteLength;
    if (size > MAX_MAPBOX_RESPONSE_BYTES) {
      void reader.cancel();
      throw new LocationProviderError(
        "location_provider_schema",
        "The permanent Mapbox response exceeded the evidence size limit"
      );
    }
    chunks.push(value);
    // biome-ignore lint/performance/noAwaitInLoops: The response stream is an ordered byte sequence with a hard size bound.
    readResult = await reader.read();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const bytes of chunks) {
    body.set(bytes, offset);
    offset += bytes.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: LocationProviderError forwards ErrorOptions to the native Error constructor.
    throw new LocationProviderError(
      "location_provider_schema",
      "The permanent Mapbox response was not valid JSON",
      { cause: error }
    );
  }
}
