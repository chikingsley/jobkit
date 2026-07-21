import {
  CLASSIFICATION_REVIEW_CASES,
  CLASSIFICATION_REVIEW_CORPUS_VERSION,
  type ClassificationLabel,
  readClassificationReviewCase,
} from "../../../src/test-lab/classification-review";
import { TestLabError } from "./errors";

interface AdjudicationRow {
  created_at: string;
  item_id: string;
  label: ClassificationLabel;
  notes: string;
  source_hash: string;
  updated_at: string;
}

export async function listClassificationReview(
  database: D1Database,
  userId: string
) {
  const decisions = await database
    .prepare(
      `SELECT item_id,source_hash,label,notes,created_at,updated_at
         FROM test_lab_classification_adjudications
        WHERE user_id=? AND corpus_version=?
        ORDER BY updated_at DESC`
    )
    .bind(userId, CLASSIFICATION_REVIEW_CORPUS_VERSION)
    .all<AdjudicationRow>();
  const adjudications = decisions.results.map(toAdjudication);
  return {
    adjudications,
    cases: CLASSIFICATION_REVIEW_CASES,
    corpusVersion: CLASSIFICATION_REVIEW_CORPUS_VERSION,
    summary: {
      decided: adjudications.length,
      remaining: CLASSIFICATION_REVIEW_CASES.length - adjudications.length,
      total: CLASSIFICATION_REVIEW_CASES.length,
    },
  };
}

export async function saveClassificationAdjudication(
  database: D1Database,
  userId: string,
  itemId: string,
  input: { label: ClassificationLabel; notes: string }
) {
  const reviewCase = readClassificationReviewCase(itemId);
  if (!reviewCase) {
    throw new TestLabError("Classification review case was not found", 404);
  }
  const timestamp = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO test_lab_classification_adjudications
         (user_id,corpus_version,item_id,source_hash,label,notes,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id,corpus_version,item_id) DO UPDATE SET
         source_hash=excluded.source_hash,
         label=excluded.label,
         notes=excluded.notes,
         updated_at=excluded.updated_at`
    )
    .bind(
      userId,
      CLASSIFICATION_REVIEW_CORPUS_VERSION,
      reviewCase.itemId,
      reviewCase.sourceHash,
      input.label,
      input.notes,
      timestamp,
      timestamp
    )
    .run();
  const row = await database
    .prepare(
      `SELECT item_id,source_hash,label,notes,created_at,updated_at
         FROM test_lab_classification_adjudications
        WHERE user_id=? AND corpus_version=? AND item_id=?`
    )
    .bind(userId, CLASSIFICATION_REVIEW_CORPUS_VERSION, itemId)
    .first<AdjudicationRow>();
  if (!row) {
    throw new Error("Classification adjudication could not be read back");
  }
  return toAdjudication(row);
}

export async function clearClassificationAdjudication(
  database: D1Database,
  userId: string,
  itemId: string
) {
  const reviewCase = readClassificationReviewCase(itemId);
  if (!reviewCase) {
    throw new TestLabError("Classification review case was not found", 404);
  }
  await database
    .prepare(
      `DELETE FROM test_lab_classification_adjudications
        WHERE user_id=? AND corpus_version=? AND item_id=?`
    )
    .bind(userId, CLASSIFICATION_REVIEW_CORPUS_VERSION, itemId)
    .run();
  return { itemId: reviewCase.itemId };
}

function toAdjudication(row: AdjudicationRow) {
  return {
    createdAt: row.created_at,
    itemId: row.item_id,
    label: row.label,
    notes: row.notes,
    sourceHash: row.source_hash,
    updatedAt: row.updated_at,
  };
}
