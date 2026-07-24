import {
  activeIdentityPositionItemSql,
  activeListingItemSql,
  claimableListingItemSql,
  claimablePositionItemSql,
} from "./stage-sql";

type ClaimableItemTable =
  | "public_projection_listing_items"
  | "public_projection_position_items";

/**
 * A correlated pending-work predicate for a claim-loop stage: the run owns at
 * least one item the stage consumer's claim query would lease right now.
 */
export function claimableItemsExistSql(
  table: ClaimableItemTable,
  stages: readonly string[]
) {
  const claimable =
    table === "public_projection_listing_items"
      ? claimableListingItemSql("item")
      : claimablePositionItemSql("item");
  const stageList = stages.map((stage) => `'${stage}'`).join(",");
  return `EXISTS (
    SELECT 1 FROM ${table} item
     WHERE item.run_id=run.id
       AND item.stage IN (${stageList})
       AND ${claimable}
  )`;
}

/**
 * The D2 upstream boundary: every listing item and identity-stage position
 * of the run reached a terminal status. Shares the same active-item
 * fragments the duplicate-comparison boundary reader counts with.
 */
export function activeStageItemsAbsentSql() {
  return `NOT EXISTS (
    SELECT 1 FROM public_projection_listing_items item
     WHERE item.run_id=run.id AND ${activeListingItemSql("item")}
  )
  AND NOT EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.run_id=run.id AND ${activeIdentityPositionItemSql("item")}
  )`;
}
