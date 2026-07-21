import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  CORPUS_LABELS,
  type CorpusFinalLabel,
  type CorpusLabel,
} from "./contracts";
import {
  assignGroupedSplits,
  assignLeakageGroups,
  groupingProtocol,
  SPLIT_VERSION,
} from "./grouping";
import { corpusItems, freezeCorpus, openCorpusLedger } from "./ledger";

const ClassificationLabelSchema = z.enum(CORPUS_LABELS);
const ReviewResponseSchema = z.object({
  adjudications: z.array(
    z.object({
      itemId: z.string(),
      label: ClassificationLabelSchema,
      notes: z.string(),
      sourceHash: z.string(),
      updatedAt: z.string(),
    })
  ),
  corpusVersion: z.string(),
  summary: z.object({
    decided: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

interface BlindLabelRow {
  confidence: "high" | "low" | "medium";
  item_id: string;
  label: CorpusLabel;
}

export async function finalizeCorpus(input: {
  corpusVersion: string;
  databasePath: string;
  reviewUrl: string;
}) {
  const review = await fetchReview(input.reviewUrl);
  if (review.corpusVersion !== input.corpusVersion) {
    throw new Error(
      `Review corpus ${review.corpusVersion} does not match ${input.corpusVersion}`
    );
  }
  if (review.summary.remaining !== 0) {
    throw new Error(
      `Review is incomplete: ${review.summary.remaining} decisions remain`
    );
  }
  const database = openCorpusLedger(input.databasePath);
  try {
    const items = corpusItems(database, input.corpusVersion);
    const finalLabels = buildFinalLabels(
      database,
      input.corpusVersion,
      review.adjudications
    );
    const groups = assignLeakageGroups(items);
    const assignments = assignGroupedSplits(
      groups,
      finalLabels,
      input.corpusVersion
    );
    validateReviewHashes(items, review.adjudications);
    freezeCorpus(database, {
      adjudications: review.adjudications.map((decision) => ({
        itemId: decision.itemId,
        label: decision.label,
        notes: decision.notes,
        reviewedAt: decision.updatedAt,
        sourceHash: decision.sourceHash,
      })),
      assignments,
      corpusVersion: input.corpusVersion,
      finalLabels,
      groups,
      reviewSource: input.reviewUrl,
      splitVersion: SPLIT_VERSION,
    });
    return summarize(finalLabels, groups, assignments);
  } finally {
    database.close();
  }
}

async function fetchReview(reviewUrl: string) {
  const response = await fetch(reviewUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Classification review returned ${response.status}`);
  }
  return ReviewResponseSchema.parse(await response.json());
}

function buildFinalLabels(
  database: Database,
  corpusVersion: string,
  adjudications: Array<{
    itemId: string;
    label: CorpusLabel;
    notes: string;
    sourceHash: string;
  }>
) {
  const decisions = new Map(
    adjudications.map((decision) => [decision.itemId, decision])
  );
  const items = corpusItems(database, corpusVersion);
  const labels = database
    .query(
      `SELECT item_id,label,confidence
         FROM corpus_labels
        WHERE corpus_version=?
        ORDER BY item_id,pass_id`
    )
    .all(corpusVersion) as BlindLabelRow[];
  const labelsByItem = new Map<string, BlindLabelRow[]>();
  for (const label of labels) {
    labelsByItem.set(label.item_id, [
      ...(labelsByItem.get(label.item_id) ?? []),
      label,
    ]);
  }
  return items.map((item): CorpusFinalLabel => {
    const blindLabels = labelsByItem.get(item.itemId) ?? [];
    if (blindLabels.length !== 2) {
      throw new Error(`${item.itemId} must have exactly two blind labels`);
    }
    const distinct = new Set(blindLabels.map((label) => label.label));
    const lowConfidence = blindLabels.some(
      (label) => label.confidence === "low"
    );
    const decision = decisions.get(item.itemId);
    if (distinct.size > 1) {
      if (!decision) {
        throw new Error(`${item.itemId} requires operator adjudication`);
      }
      return {
        itemId: item.itemId,
        label: decision.label,
        notes: decision.notes,
        provenance: "operator_adjudication",
        sourceHash: item.sourceHash,
      };
    }
    const agreedLabel = blindLabels[0]?.label;
    if (!agreedLabel) {
      throw new Error(`${item.itemId} has no agreed label`);
    }
    return {
      itemId: item.itemId,
      label: agreedLabel,
      notes: lowConfidence
        ? "Both blind passes agreed; one pass reported low confidence."
        : "",
      provenance: lowConfidence
        ? "model_agreement_low_confidence"
        : "model_agreement",
      sourceHash: item.sourceHash,
    };
  });
}

function validateReviewHashes(
  items: ReturnType<typeof corpusItems>,
  adjudications: Array<{ itemId: string; sourceHash: string }>
) {
  const hashes = new Map(items.map((item) => [item.itemId, item.sourceHash]));
  for (const decision of adjudications) {
    if (hashes.get(decision.itemId) !== decision.sourceHash) {
      throw new Error(`Source hash changed for ${decision.itemId}`);
    }
  }
}

function summarize(
  labels: CorpusFinalLabel[],
  groups: ReturnType<typeof assignLeakageGroups>,
  assignments: ReturnType<typeof assignGroupedSplits>
) {
  const groupSizes = new Map<string, number>();
  for (const group of groups) {
    groupSizes.set(group.groupId, (groupSizes.get(group.groupId) ?? 0) + 1);
  }
  const splitLabels = Object.fromEntries(
    ["train", "held_out"].map((split) => [
      split,
      Object.fromEntries(
        CORPUS_LABELS.map((label) => [
          label,
          assignments.filter(
            (assignment) =>
              assignment.split === split &&
              labels.find((item) => item.itemId === assignment.itemId)
                ?.label === label
          ).length,
        ])
      ),
    ])
  );
  return {
    adjudicated: labels.filter(
      (label) => label.provenance === "operator_adjudication"
    ).length,
    finalLabels: labels.length,
    grouping: {
      groups: groupSizes.size,
      largestGroup: Math.max(...groupSizes.values()),
      multiItemGroups: [...groupSizes.values()].filter((size) => size > 1)
        .length,
      protocol: groupingProtocol(),
    },
    lowConfidenceAgreements: labels.filter(
      (label) => label.provenance === "model_agreement_low_confidence"
    ).length,
    splits: {
      heldOut: assignments.filter((item) => item.split === "held_out").length,
      labels: splitLabels,
      train: assignments.filter((item) => item.split === "train").length,
    },
  };
}
