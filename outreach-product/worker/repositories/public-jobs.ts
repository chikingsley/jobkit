import { publicSearchTerms } from "../public-jobs/catalog";
import {
  decodePublicJobCursor,
  encodePublicJobCursor,
  type NormalizedPublicJobListRequest,
  PublicJobCursorError,
  type PublicJobCursorTuple,
  publicJobQueryHash,
} from "../public-jobs/query";
import {
  PUBLIC_JOB_LIST_SCHEMA_VERSION,
  type PublicJobDetailResponse,
  type PublicJobListResponse,
  PublicJobListResponseSchema,
  type PublicJobListScope,
  type PublicJobReadRow,
  serializePublicJobDetailValue,
  serializePublicJobListItemValue,
} from "../public-jobs/schemas";

interface CatalogRow {
  material_changed_at: string;
  membership_hash: string;
  representation_updated_at: string;
  search_index_version: string;
  version: string;
}

export interface PublicJobListServerMetadata {
  cursor: string | null;
  membershipHash: string;
  queryHash: string;
  representationUpdatedAt: string;
}

export interface PublicJobListServerResult {
  data: PublicJobListResponse;
  metadata: PublicJobListServerMetadata;
}

interface PublicJobListRow extends PublicJobReadRow {
  conservative_hourly_usd: number | null;
  effective_recency: string;
  item_json: string;
  search_rank: number;
  title_sort_key: string;
}

interface RouteResolutionRow {
  detail_json: string | null;
  eligibility_decision_hash: string | null;
  noindex: number;
  public_content_hash: string | null;
  representation_updated_at: string | null;
  route_action: "gone" | "permanent_redirect" | "serve";
  target_path: string | null;
}

const publicIdPattern = /^pjob_v1_[0-9a-f]{64}$/u;
const publicSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const canonicalTargetPathPattern =
  /^\/job\/pjob_v1_[0-9a-f]{64}\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type PublicJobDetailResult =
  | { data: PublicJobDetailResponse; kind: "serve"; noindex: boolean }
  | { kind: "redirect"; targetPath: string }
  | { kind: "gone" }
  | { kind: "missing" };

interface PublicMarketScopeRow {
  city_slug: string | null;
  country_code: string;
  country_count: number;
  country_slug: string;
  display_name: string | null;
}

export async function resolvePublicJobMarketScope(
  db: Pick<D1Database, "prepare">,
  input: { citySlug?: string; countrySlug: string }
): Promise<PublicJobListScope | null> {
  if (
    !publicSlugPattern.test(input.countrySlug) ||
    (input.citySlug !== undefined && !publicSlugPattern.test(input.citySlug))
  ) {
    return null;
  }
  const city = input.citySlug ?? null;
  const row = await db
    .prepare(
      `SELECT
         MIN(facet.country_code) AS country_code,
         MIN(facet.country_slug) AS country_slug,
         CASE WHEN ? IS NULL THEN NULL ELSE MIN(facet.city_slug) END AS city_slug,
         CASE WHEN ? IS NULL THEN NULL ELSE MIN(facet.display_name) END
           AS display_name,
         COUNT(DISTINCT facet.country_code) AS country_count
       FROM public_job_catalog_head_pointer head
       JOIN public_browse_job_locations facet
         ON facet.catalog_version=head.current_version
      WHERE facet.country_slug=?
        AND (? IS NULL OR (
          facet.city_slug=? AND facet.location_role='worksite'
        ))`
    )
    .bind(city, city, input.countrySlug, city, city)
    .first<PublicMarketScopeRow>();
  if (row?.country_count !== 1) {
    return null;
  }
  if (city === null) {
    return {
      countryCode: row.country_code,
      countrySlug: row.country_slug,
      kind: "country",
    };
  }
  if (row.city_slug === null || row.display_name === null) {
    return null;
  }
  return {
    citySlug: row.city_slug,
    countryCode: row.country_code,
    countrySlug: row.country_slug,
    displayName: row.display_name,
    kind: "city",
  };
}

export type PublicJobDetailServerResult =
  | {
      data: PublicJobDetailResponse;
      kind: "serve";
      metadata: {
        canonicalPath: string;
        eligibilityDecisionHash: string;
        publicContentHash: string;
        representationUpdatedAt: string;
      };
      noindex: boolean;
    }
  | Exclude<PublicJobDetailResult, { kind: "serve" }>;

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
         resolution.representation_updated_at
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
        publicContentHash: row.public_content_hash,
        representationUpdatedAt: row.representation_updated_at,
      },
      noindex: row.noindex === 1,
    };
  } catch {
    return { kind: "missing" };
  }
}

async function readCatalogHead(db: D1Database) {
  const catalog = await db
    .prepare(
      `SELECT version,membership_hash,representation_updated_at,
              material_changed_at,search_index_version
         FROM public_job_catalog_head
        LIMIT 1`
    )
    .first<CatalogRow>();
  if (!catalog) {
    throw new Error("Public job catalog head is missing");
  }
  return catalog;
}

function listStatement(input: {
  catalog: CatalogRow;
  cursorTuple: PublicJobCursorTuple | null;
  request: NormalizedPublicJobListRequest;
}) {
  const conditions = [
    "browse.catalog_version=?",
    "search.search_index_version=?",
    "search.public_job_version=browse.public_job_version",
  ];
  const conditionBindings: unknown[] = [
    input.catalog.version,
    input.catalog.search_index_version,
  ];
  const joinBindings: unknown[] = [];
  let rankingJoin = "";
  let searchRank = "0.0";
  if (input.request.query.q !== null) {
    const terms = [...new Set(publicSearchTerms(input.request.query.q))];
    if (terms.length === 0) {
      conditions.push("0");
    } else {
      rankingJoin = `JOIN (
        SELECT term.public_job_id,term.public_job_version,
               -SUM(term.score) AS search_rank
          FROM public_job_search_terms term
          JOIN json_each(?) query_term ON query_term.value=term.term
         WHERE term.search_index_version=?
         GROUP BY term.public_job_id,term.public_job_version
        HAVING COUNT(DISTINCT term.term)=?
      ) ranked
        ON ranked.public_job_id=browse.public_job_id
       AND ranked.public_job_version=browse.public_job_version`;
      joinBindings.push(
        JSON.stringify(terms),
        input.catalog.search_index_version,
        terms.length
      );
      searchRank = "ranked.search_rank";
    }
  }
  const countryCode =
    input.request.scope.kind === "global"
      ? input.request.query.country
      : input.request.scope.countryCode;
  if (input.request.scope.kind === "city") {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM public_browse_job_locations facet
        WHERE facet.catalog_version=browse.catalog_version
          AND facet.public_job_id=browse.public_job_id
          AND facet.public_job_version=browse.public_job_version
          AND facet.country_code=? AND facet.city_slug=?
          AND facet.location_role='worksite'
      )`
    );
    conditionBindings.push(countryCode, input.request.scope.citySlug);
  } else if (countryCode !== null) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM public_browse_job_locations facet
        WHERE facet.catalog_version=browse.catalog_version
          AND facet.public_job_id=browse.public_job_id
          AND facet.public_job_version=browse.public_job_version
          AND facet.country_code=?
          AND (
            facet.location_role='worksite'
            OR (browse.workplace_type='remote'
              AND facet.location_role='applicant_area')
          )
      )`
    );
    conditionBindings.push(countryCode);
  }
  if (input.request.query.workplace !== null) {
    conditions.push("browse.workplace_type=?");
    conditionBindings.push(input.request.query.workplace);
  }
  if (input.request.query.employmentType !== null) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM json_each(browse.employment_types_json)
        WHERE value=?
      )`
    );
    conditionBindings.push(input.request.query.employmentType);
  }
  if (input.request.query.compensation !== null) {
    conditions.push("json_extract(browse.compensation_json,'$.kind')=?");
    conditionBindings.push(
      input.request.query.compensation === "stated" ? "amount" : "negotiable"
    );
  }
  if (input.cursorTuple) {
    const keyset = keysetCondition(input.cursorTuple, searchRank);
    conditions.push(keyset.sql);
    conditionBindings.push(...keyset.bindings);
  }
  conditionBindings.push(input.request.query.limit + 1);
  const order = orderBy(input.request.query.sort, searchRank);
  return {
    bindings: [...joinBindings, ...conditionBindings],
    sql: `SELECT
            browse.public_job_id,browse.public_job_version,
            browse.canonical_slug,browse.title,browse.organization_name,
            browse.workplace_type,browse.date_posted,
            browse.date_posted_provenance,browse.valid_through,
            browse.valid_through_provenance,browse.employment_types_json,
            browse.compensation_json,browse.material_changed_at,
            browse.verified_at,browse.application_available,
            browse.locations_json,browse.source_attributions_json,
            browse.item_json,
            'published' AS publication_state,
            search.title_sort_key,search.effective_recency,
            search.conservative_hourly_usd,${searchRank} AS search_rank
          FROM public_browse_jobs browse
          JOIN public_job_search_index search
            ON search.public_job_id=browse.public_job_id
           AND search.public_job_version=browse.public_job_version
          ${rankingJoin}
         WHERE ${conditions.join(" AND ")}
         ORDER BY ${order}
         LIMIT ?`,
  };
}

function keysetCondition(
  tuple: PublicJobCursorTuple,
  searchRank: string
): { bindings: unknown[]; sql: string } {
  if (tuple.sort === "relevance") {
    return {
      bindings: [
        tuple.rank,
        tuple.rank,
        tuple.recency,
        tuple.recency,
        tuple.publicId,
      ],
      sql: `(${searchRank}>? OR (${searchRank}=? AND
        (search.effective_recency<? OR
          (search.effective_recency=? AND browse.public_job_id>?))))`,
    };
  }
  if (tuple.sort === "recent") {
    return {
      bindings: [tuple.recency, tuple.recency, tuple.publicId],
      sql: `(search.effective_recency<? OR
        (search.effective_recency=? AND browse.public_job_id>?))`,
    };
  }
  if (tuple.sort === "title") {
    return {
      bindings: [tuple.title, tuple.title, tuple.publicId],
      sql: `(search.title_sort_key>? OR
        (search.title_sort_key=? AND browse.public_job_id>?))`,
    };
  }
  const nullRank = tuple.hourlyUsd === null ? 1 : 0;
  if (tuple.hourlyUsd === null) {
    return {
      bindings: [
        nullRank,
        nullRank,
        tuple.recency,
        tuple.recency,
        tuple.publicId,
      ],
      sql: `((search.conservative_hourly_usd IS NULL)>? OR
        ((search.conservative_hourly_usd IS NULL)=? AND
          (search.effective_recency<? OR
            (search.effective_recency=? AND browse.public_job_id>?))))`,
    };
  }
  return {
    bindings: [
      nullRank,
      nullRank,
      tuple.hourlyUsd,
      tuple.hourlyUsd,
      tuple.recency,
      tuple.recency,
      tuple.publicId,
    ],
    sql: `((search.conservative_hourly_usd IS NULL)>? OR
      ((search.conservative_hourly_usd IS NULL)=? AND
        (search.conservative_hourly_usd<? OR
          (search.conservative_hourly_usd=? AND
            (search.effective_recency<? OR
              (search.effective_recency=? AND browse.public_job_id>?))))))`,
  };
}

function orderBy(
  sort: PublicJobListResponse["query"]["sort"],
  searchRank: string
) {
  if (sort === "relevance") {
    return `${searchRank} ASC,search.effective_recency DESC,browse.public_job_id ASC`;
  }
  if (sort === "hourlyUsd") {
    return `(search.conservative_hourly_usd IS NULL) ASC,
      search.conservative_hourly_usd DESC,search.effective_recency DESC,
      browse.public_job_id ASC`;
  }
  if (sort === "title") {
    return "search.title_sort_key ASC,browse.public_job_id ASC";
  }
  return "search.effective_recency DESC,browse.public_job_id ASC";
}

function cursorFromRow(
  row: PublicJobListRow,
  sort: PublicJobListResponse["query"]["sort"]
): PublicJobCursorTuple {
  if (sort === "relevance") {
    return {
      publicId: row.public_job_id,
      rank: row.search_rank,
      recency: row.effective_recency,
      sort,
    };
  }
  if (sort === "hourlyUsd") {
    return {
      hourlyUsd: row.conservative_hourly_usd,
      publicId: row.public_job_id,
      recency: row.effective_recency,
      sort,
    };
  }
  if (sort === "title") {
    return { publicId: row.public_job_id, sort, title: row.title_sort_key };
  }
  return { publicId: row.public_job_id, recency: row.effective_recency, sort };
}

function validListRows(rows: PublicJobListRow[]) {
  const valid: Array<{
    item: ReturnType<typeof serializePublicJobListItemValue>;
    row: PublicJobListRow;
  }> = [];
  for (const row of rows) {
    try {
      valid.push({
        item: serializePublicJobListItemValue(
          JSON.parse(row.item_json) as unknown
        ),
        row,
      });
    } catch {
      // A malformed immutable member is isolated from the rest of the page.
    }
  }
  return valid;
}

function pageBoundary(
  validRows: Array<{ item: unknown; row: PublicJobListRow }>,
  limit: number
) {
  return validRows[Math.min(validRows.length, limit) - 1]?.row;
}

function canonicalTargetPath(value: string) {
  return canonicalTargetPathPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
