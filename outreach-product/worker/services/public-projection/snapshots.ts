import type { PublicProjectionScope } from "./contracts";
import { sha256Hex } from "./hash";

interface PolicyHeadRow {
  current_version: number;
  policy_hash: string;
  source_key: string;
}

interface SourceCohortRow {
  id: string;
  material_changed_at: string;
  material_hash: string;
  material_hash_version: number;
  material_version: number;
}

export interface PublicProjectionSourceWatermark {
  activeCount: number;
  cohortHash: string;
  materialChangedAt: string;
  maxListingId: string;
}

export async function publicProjectionPolicyHeadsHash(db: D1Database) {
  const policies = await db
    .prepare(
      `SELECT head.source_key,head.current_version,version.policy_hash
         FROM source_publication_policy_heads head
         JOIN source_publication_policy_versions version
           ON version.source_key=head.source_key
          AND version.version=head.current_version
        ORDER BY head.source_key`
    )
    .all<PolicyHeadRow>();
  return sha256Hex(JSON.stringify(policies.results));
}

export async function publicProjectionSourceWatermark(
  db: D1Database,
  scope: PublicProjectionScope
): Promise<PublicProjectionSourceWatermark> {
  const scopeJson = JSON.stringify(scope);
  const cohort = await db
    .prepare(
      `SELECT listing.id,listing.material_version,version.material_hash,
              version.material_hash_version,listing.material_changed_at
         FROM job_listings listing
         JOIN job_listing_versions version
           ON version.listing_id=listing.id
          AND version.material_version=listing.material_version
        WHERE listing.inventory_status='active'
          AND (
            json_array_length(json_extract(?,'$.boards'))=0
            OR listing.board IN (
              SELECT CAST(value AS TEXT)
                FROM json_each(json_extract(?,'$.boards'))
            )
          )
          AND (
            json_array_length(json_extract(?,'$.listingIds'))=0
            OR listing.id IN (
              SELECT CAST(value AS TEXT)
                FROM json_each(json_extract(?,'$.listingIds'))
            )
          )
        ORDER BY listing.id`
    )
    .bind(scopeJson, scopeJson, scopeJson, scopeJson)
    .all<SourceCohortRow>();
  const canonicalCohort = cohort.results.map((row) => ({
    id: row.id,
    materialHash: row.material_hash,
    materialHashVersion: row.material_hash_version,
    materialVersion: row.material_version,
  }));
  return {
    activeCount: canonicalCohort.length,
    cohortHash: await sha256Hex(JSON.stringify(canonicalCohort)),
    materialChangedAt: cohort.results.reduce(
      (latest, row) =>
        row.material_changed_at > latest ? row.material_changed_at : latest,
      ""
    ),
    maxListingId: cohort.results.at(-1)?.id ?? "",
  };
}
