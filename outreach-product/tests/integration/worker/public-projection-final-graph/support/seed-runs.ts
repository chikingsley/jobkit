import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../../src/features/inventory/content";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../../../src/features/public/identity-signals";
import {
  canonicalJson,
  canonicalSha256,
  compareUtf8Bytes,
} from "../../../../../worker/services/public-projection/hash";
import {
  publicProjectionPolicyHeadsHash,
  publicProjectionSourceWatermark,
} from "../../../../../worker/services/public-projection/snapshots";
import { jobFixture } from "./fixtures";
import { type PositionFixture, testEnv, timestamp } from "./model";
import { finishD2, seedCanonicalResolution } from "./seed-resolutions";

export async function seedResolvedRun(input: {
  advanceable?: boolean;
  beforeD2?: (positions: PositionFixture[]) => Promise<void>;
  positions: {
    canonicalSignalHash: string;
    sourcePositionId: string;
    sourceReference: string;
  }[];
  runId: string;
}) {
  const listingIds = input.positions.map(
    (position) => `listing:${position.sourcePositionId}`
  );
  if (input.advanceable) {
    await seedListingMaterials(
      input.positions.map((position, index) => ({
        listingId: listingIds[index] ?? "",
        sourceReference: position.sourceReference,
      }))
    );
    await seedAdvanceableRun(input.runId, listingIds);
  } else {
    await seedRun(input.runId);
  }
  const positions: PositionFixture[] = [];
  for (const [index, specification] of input.positions.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: Ordered inserts intentionally vary the D2 row order.
    const position = await seedPosition({
      itemId: `${input.runId}:position:${index}`,
      listingId: listingIds[index] ?? "",
      runId: input.runId,
      sourcePositionId: specification.sourcePositionId,
      sourceReference: specification.sourceReference,
    });
    positions.push(position);
  }
  await input.beforeD2?.(positions);
  const batch = await finishD2(input.runId);
  for (const [index, position] of positions.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: Resolution fixtures mirror one sealed position at a time.
    await seedCanonicalResolution({
      batchInputHash: batch.inputHash,
      canonicalSignalHash: input.positions[index]?.canonicalSignalHash ?? "",
      position,
      runId: input.runId,
    });
  }
  return { positions, runId: input.runId };
}

export async function seedRun(runId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_runs (
      id,mode,request_key,scope_json,contract_version,projector_version,
      policy_heads_hash,source_watermark_json,status,selection_complete,
      started_at,requested_at,updated_at
    ) VALUES (
      ?,'shadow',?,'{"boards":[],"listingIds":[]}',1,'projector-v1',?,
      '{"materialChangedAt":"2026-07-22T12:00:00.000Z",\
        "maxListingId":"z"}','running',1,?,?,?
    )`
  )
    .bind(
      runId,
      `request:${runId}`,
      "a".repeat(64),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

export async function seedAdvanceableRun(runId: string, listingIds: string[]) {
  const scope = { boards: [], listingIds };
  const [policyHeadsHash, sourceWatermark] = await Promise.all([
    publicProjectionPolicyHeadsHash(testEnv.DB),
    publicProjectionSourceWatermark(testEnv.DB, scope),
  ]);
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_runs (
      id,mode,request_key,scope_json,contract_version,projector_version,
      policy_heads_hash,source_watermark_json,status,selection_complete,
      listing_total,listing_completed,position_total,
      started_at,requested_at,updated_at
    ) VALUES (?,'shadow',?,?,1,'projector-v1',?,?,'running',1,?,?,?, ?,?,?)`
  )
    .bind(
      runId,
      `request:${runId}`,
      JSON.stringify(scope),
      policyHeadsHash,
      JSON.stringify(sourceWatermark),
      listingIds.length,
      listingIds.length,
      listingIds.length,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

export async function seedListingMaterials(
  listings: { listingId: string; sourceReference: string }[]
) {
  for (const listing of listings) {
    const job = jobFixture(listing.listingId, listing.sourceReference);
    const materialJson = serializeInventoryJobMaterial(job);
    // biome-ignore lint/performance/noAwaitInLoops: Exact listing material fixtures establish the source watermark before the run is sealed.
    const materialHash = await inventoryJobMaterialHash(job);
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT OR IGNORE INTO job_listings (
          id,board,title,company,salary,description,apply_url,first_seen_at,
          updated_at,inventory_status,material_hash,material_hash_version,
          material_version,material_changed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
      ).bind(
        listing.listingId,
        job.board,
        job.title,
        job.company,
        job.salary,
        job.description,
        job.applyUrl,
        timestamp,
        timestamp,
        materialHash,
        timestamp
      ),
      testEnv.DB.prepare(
        `INSERT OR IGNORE INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,created_at
        ) VALUES (?,1,?,1,?,?)`
      ).bind(listing.listingId, materialHash, materialJson, timestamp),
    ]);
  }
}

export async function seedPosition(input: {
  itemId: string;
  listingId: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  const job = jobFixture(input.listingId, input.sourceReference);
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      input.listingId,
      job.board,
      job.title,
      job.company,
      job.salary,
      job.description,
      job.applyUrl,
      timestamp,
      timestamp,
      materialHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,1,?,1,?,?)`
    ).bind(input.listingId, materialHash, materialJson, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_listing_items (
        id,run_id,listing_id,material_version,input_hash,stage,status,
        checkpoint_json,created_at,completed_at,updated_at
      ) VALUES (?, ?, ?, 1, ?, 'completed','completed','{}', ?, ?, ?)`
    ).bind(
      `listing-item:${input.runId}:${input.listingId}`,
      input.runId,
      input.listingId,
      materialHash,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(input.sourcePositionId, input.listingId, timestamp),
  ]);
  const signals = await Promise.all([
    materialCloneSignal(materialHash),
    sourceReferenceSignal({
      sourceKey: "tefl",
      sourceReference: input.sourceReference,
    }),
  ]);
  signals.sort((left, right) => compareUtf8Bytes(left.kind, right.kind));
  const inputHash = await canonicalSha256({
    sourcePositionId: input.sourcePositionId,
    version: 1,
  });
  const checkpoint = canonicalJson({
    identity: {
      signals,
      sourcePosition: { id: input.sourcePositionId, positionKey: "direct" },
      state: "derived",
    },
    listingInputHash: materialHash,
  });
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_position_items (
      id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
      checkpoint_json,created_at,updated_at
    ) VALUES (?, ?, ?, ?, ?, 'canonical_resolution','queued',?, ?, ?)`
  )
    .bind(
      input.itemId,
      input.runId,
      `listing-item:${input.runId}:${input.listingId}`,
      input.sourcePositionId,
      inputHash,
      checkpoint,
      timestamp,
      timestamp
    )
    .run();
  return {
    inputHash,
    itemId: input.itemId,
    listingId: input.listingId,
    sourcePositionId: input.sourcePositionId,
  } satisfies PositionFixture;
}
