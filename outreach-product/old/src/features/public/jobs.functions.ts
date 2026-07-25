import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import {
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { z } from "zod";
import {
  normalizePublicJobListRequest,
  PublicJobCursorError,
  PublicJobQueryError,
} from "../../../worker/public-jobs/query";
import type {
  PublicJobDetailResponse,
  PublicJobListResponse,
  PublicJobListScope,
} from "../../../worker/public-jobs/schemas";
import {
  publicJobDetailEtag,
  publicJobListEtag,
  publicValidatorHeaders,
} from "../../../worker/public-jobs/validators";
import {
  readPublicJobDetailWithMetadata,
  readPublicJobListWithMetadata,
  resolvePublicJobMarketScope,
} from "../../../worker/repositories/public-jobs";
import type { JobKitStartRequestContext } from "../../server-context";
import { resolvePublicJobCursorSecret } from "./cursor-secret";
import {
  type PublicJobsSearch,
  publicJobsSearchParameters,
  publicJobsSearchSchema,
} from "./job-search";

const PublicJobListServerInputSchema = z
  .object({
    market: z
      .object({
        citySlug: z.string().optional(),
        countrySlug: z.string(),
      })
      .strict()
      .optional(),
    search: publicJobsSearchSchema,
  })
  .strict();

const PublicJobDetailServerInputSchema = z
  .object({
    publicId: z.string(),
    slug: z.string(),
  })
  .strict();

export type PublicJobListResult =
  | { data: PublicJobListResponse; kind: "success" }
  | { code: string; kind: "bad_request" | "stale_cursor" };

export type PublicJobDetailResult =
  | {
      data: PublicJobDetailResponse;
      jobPostingEligible: boolean;
      kind: "success";
      noindex: boolean;
    }
  | { kind: "gone" };

export const getPublicJobList = createServerFn({ method: "GET" })
  .validator(PublicJobListServerInputSchema)
  .handler(async ({ data }) => {
    const context = requireJobKitStartContext();
    const cursorSecret = resolvePublicJobCursorSecret(
      context.env,
      import.meta.env.DEV
    );
    try {
      const scope = data.market
        ? await resolvePublicJobMarketScope(context.env.DB, data.market)
        : { kind: "global" as const };
      if (scope === null) {
        setResponseStatus(404);
        throw notFound();
      }
      const canonicalMarketPath = publicMarketCanonicalRedirect({
        market: data.market,
        scope,
        search: data.search,
      });
      if (canonicalMarketPath) {
        throw redirect({
          href: canonicalMarketPath,
          statusCode: 308,
        });
      }
      const request = normalizePublicJobListRequest(
        publicJobsSearchParameters(data.search),
        scope
      );
      const result = await readPublicJobListWithMetadata(context.env.DB, {
        ...request,
        cursorSecret,
      });
      applyPublicValidatorHeaders({
        etag: await publicJobListEtag({
          cursor: result.metadata.cursor,
          membershipHash: result.metadata.membershipHash,
          queryHash: result.metadata.queryHash,
          scope: result.data.scope,
          searchIndexVersion: result.data.catalog.searchIndexVersion,
        }),
        lastModified: result.metadata.representationUpdatedAt,
      });
      setResponseStatus(200);
      return { data: result.data, kind: "success" } as const;
    } catch (error) {
      if (error instanceof PublicJobQueryError) {
        setResponseStatus(400);
        return { code: error.code, kind: "bad_request" } as const;
      }
      if (error instanceof PublicJobCursorError) {
        setResponseStatus(error.code === "stale" ? 409 : 400);
        return {
          code: error.code,
          kind: error.code === "stale" ? "stale_cursor" : "bad_request",
        } as const;
      }
      throw error;
    }
  });

function publicMarketCanonicalRedirect(input: {
  market?: { citySlug?: string; countrySlug: string };
  scope: PublicJobListScope | { kind: "global" };
  search: PublicJobsSearch;
}) {
  if (
    !input.market ||
    input.scope.kind === "global" ||
    input.scope.countrySlug === input.market.countrySlug
  ) {
    return null;
  }
  const canonicalPath =
    input.scope.kind === "city"
      ? `/jobs/${input.scope.countrySlug}/${input.scope.citySlug}`
      : `/jobs/${input.scope.countrySlug}`;
  const search = publicJobsSearchParameters(input.search).toString();
  return search ? `${canonicalPath}?${search}` : canonicalPath;
}

export const getPublicJobDetail = createServerFn({ method: "GET" })
  .validator(PublicJobDetailServerInputSchema)
  .handler(async ({ data }): Promise<PublicJobDetailResult> => {
    const context = requireJobKitStartContext();
    const result = await readPublicJobDetailWithMetadata(context.env.DB, data);
    if (result.kind === "missing") {
      setResponseStatus(404);
      throw notFound();
    }
    if (result.kind === "redirect") {
      throw redirect({ href: result.targetPath, statusCode: 308 });
    }
    if (result.kind === "gone") {
      setResponseStatus(410);
      return { kind: "gone" } as const;
    }
    applyPublicValidatorHeaders({
      etag: await publicJobDetailEtag(result.metadata),
      lastModified: result.metadata.representationUpdatedAt,
    });
    setResponseStatus(200);
    return {
      data: result.data,
      jobPostingEligible: result.metadata.jobPostingEligible,
      kind: "success",
      noindex: result.noindex,
    } as const;
  });

function applyPublicValidatorHeaders(validators: {
  etag: string;
  lastModified: string;
}) {
  for (const [name, value] of publicValidatorHeaders(validators)) {
    setResponseHeader(name, value);
  }
}

function requireJobKitStartContext(): JobKitStartRequestContext {
  const context = getGlobalStartContext() as
    | JobKitStartRequestContext
    | undefined;
  if (!context) {
    throw new Error("JobKit Start request context is unavailable");
  }
  return context;
}
