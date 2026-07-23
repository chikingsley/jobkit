import { publicSearchTerms } from "../../public-jobs/catalog";
import type {
  NormalizedPublicJobListRequest,
  PublicJobCursorTuple,
} from "../../public-jobs/query";
import {
  type PublicJobListResponse,
  serializePublicJobListItemValue,
} from "../../public-jobs/schemas";
import {
  type CatalogRow,
  canonicalTargetPathPattern,
  type PublicJobListRow,
} from "./model";

export async function readCatalogHead(db: D1Database) {
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

export function listStatement(input: {
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

export function cursorFromRow(
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

export function validListRows(rows: PublicJobListRow[]) {
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

export function pageBoundary(
  validRows: Array<{ item: unknown; row: PublicJobListRow }>,
  limit: number
) {
  return validRows[Math.min(validRows.length, limit) - 1]?.row;
}

export function canonicalTargetPath(value: string) {
  return canonicalTargetPathPattern.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
