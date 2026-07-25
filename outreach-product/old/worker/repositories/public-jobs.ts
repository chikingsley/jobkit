import {
  decodePublicJobCursor,
  encodePublicJobCursor,
  type NormalizedPublicJobListRequest,
  PublicJobCursorError,
  publicJobQueryHash,
} from "../public-jobs/query";
import {
  PUBLIC_JOB_LIST_SCHEMA_VERSION,
  type PublicJobListResponse,
  PublicJobListResponseSchema,
  serializePublicJobDetailValue,
} from "../public-jobs/schemas";
import {
  type PublicJobDetailResult,
  type PublicJobDetailServerResult,
  type PublicJobListRow,
  type PublicJobListServerResult,
  publicIdPattern,
  publicSlugPattern,
  type RouteResolutionRow,
} from "./public-jobs/model";
import {
  canonicalTargetPath,
  cursorFromRow,
  isRecord,
  listStatement,
  pageBoundary,
  readCatalogHead,
  validListRows,
} from "./public-jobs/query";

export type {
  PublicJobDetailResult,
  PublicJobDetailServerResult,
  PublicJobListServerMetadata,
  PublicJobListServerResult,
} from "./public-jobs/model";
// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { resolvePublicJobMarketScope } from "./public-jobs/model";

export async function readPublicJobList(
  db: D1Database,
  input: NormalizedPublicJobListRequest & { cursorSecret: string }
): Promise<PublicJobListResponse> {
  return (await readPublicJobListWithMetadata(db, input)).data;
}

export async function readPublicJobListWithMetadata(
  db: D1Database,
  input: NormalizedPublicJobListRequest & { cursorSecret: string }
): Promise<PublicJobListServerResult> {
  const catalog = await readCatalogHead(db);
  const queryHash = await publicJobQueryHash(input);
  const cursorTuple = input.cursor
    ? await decodePublicJobCursor({
        catalogVersion: catalog.version,
        cursor: input.cursor,
        queryHash,
        secret: input.cursorSecret,
      })
    : null;
  if (cursorTuple && cursorTuple.sort !== input.query.sort) {
    throw new PublicJobCursorError("invalid");
  }

  const { bindings, sql } = listStatement({
    catalog,
    cursorTuple,
    request: input,
  });
  const page = await db
    .prepare(sql)
    .bind(...bindings)
    .all<PublicJobListRow>();
  const observedCatalog = await readCatalogHead(db);
  if (observedCatalog.version !== catalog.version) {
    if (input.cursor) {
      throw new PublicJobCursorError("stale");
    }
    throw new Error("Public job catalog changed during the list read");
  }
  const rows = validListRows(page.results);
  const items = rows.slice(0, input.query.limit).map(({ item }) => item);
  const boundary = pageBoundary(rows, input.query.limit);
  const hasMore = rows.length > input.query.limit;
  const nextCursor =
    hasMore && boundary
      ? await encodePublicJobCursor({
          catalogVersion: catalog.version,
          queryHash,
          secret: input.cursorSecret,
          tuple: cursorFromRow(boundary, input.query.sort),
        })
      : null;

  const data = PublicJobListResponseSchema.parse({
    catalog: {
      materialChangedAt: catalog.material_changed_at,
      searchIndexVersion: catalog.search_index_version,
      version: catalog.version,
    },
    items,
    page: { hasMore, nextCursor },
    query: input.query,
    schemaVersion: PUBLIC_JOB_LIST_SCHEMA_VERSION,
    scope: input.scope,
  });
  return {
    data,
    metadata: {
      cursor: input.cursor,
      membershipHash: catalog.membership_hash,
      queryHash,
      representationUpdatedAt: catalog.representation_updated_at,
    },
  };
}

export async function readPublicJobDetail(
  db: Pick<D1Database, "prepare">,
  input: { publicId: string; slug: string }
): Promise<PublicJobDetailResult> {
  const result = await readPublicJobDetailWithMetadata(db, input);
  if (result.kind !== "serve") {
    return result;
  }
  return {
    data: result.data,
    kind: result.kind,
    noindex: result.noindex,
  };
}

function resolvePublicJobDetailRow(
  row: RouteResolutionRow,
  input: { publicId: string; slug: string }
): PublicJobDetailServerResult {
  if (row.route_action === "gone") {
    return { kind: "gone" };
  }
  if (row.route_action === "permanent_redirect") {
    return row.target_path && canonicalTargetPath(row.target_path)
      ? { kind: "redirect", targetPath: row.target_path }
      : { kind: "missing" };
  }
  if (
    row.detail_json === null ||
    row.public_content_hash === null ||
    row.eligibility_decision_hash === null ||
    row.representation_updated_at === null
  ) {
    return { kind: "missing" };
  }
  try {
    const stored = JSON.parse(row.detail_json) as unknown;
    const data = serializePublicJobDetailValue(
      row.noindex === 1 && isRecord(stored)
        ? {
            ...stored,
            application: { available: false },
            status: "closed",
          }
        : stored
    );
    if (data.publicId !== input.publicId || data.canonicalSlug !== input.slug) {
      return { kind: "missing" };
    }
    return {
      data,
      kind: "serve",
      metadata: {
        canonicalPath: data.canonicalPath,
        eligibilityDecisionHash: row.eligibility_decision_hash,
        jobPostingEligible: row.job_posting_eligible === 1,
        publicContentHash: row.public_content_hash,
        representationUpdatedAt: row.representation_updated_at,
      },
      noindex: row.noindex === 1,
    };
  } catch {
    return { kind: "missing" };
  }
}

export async function readPublicJobDetailWithMetadata(
  db: Pick<D1Database, "prepare">,
  input: { publicId: string; slug: string }
): Promise<PublicJobDetailServerResult> {
  if (
    !(
      publicIdPattern.test(input.publicId) && publicSlugPattern.test(input.slug)
    )
  ) {
    return { kind: "missing" };
  }
  const rows = await db
    .prepare(
      `SELECT
         resolution.route_action,resolution.target_path,resolution.noindex,
         resolution.detail_json,resolution.public_content_hash,
         resolution.eligibility_decision_hash,
         resolution.representation_updated_at,
         CASE WHEN EXISTS (
           SELECT 1 FROM job_posting_jobs posting
            WHERE posting.public_job_id=resolution.public_job_id
              AND posting.public_job_version=CAST(
                json_extract(resolution.detail_json,'$.publicJobVersion')
                AS INTEGER
              )
         ) THEN 1 ELSE 0 END AS job_posting_eligible
       FROM public_job_route_resolutions resolution
      WHERE resolution.public_job_id=? AND resolution.requested_slug=?
        LIMIT 2`
    )
    .bind(input.publicId, input.slug)
    .all<RouteResolutionRow>();
  if (rows.results.length !== 1) {
    return { kind: "missing" };
  }
  const [row] = rows.results;
  if (!row) {
    return { kind: "missing" };
  }
  return resolvePublicJobDetailRow(row, input);
}
