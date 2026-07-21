import { z } from "zod";
import corpusJson from "./classification-review-corpus.json";

export const ClassificationLabelSchema = z.enum([
  "english_teaching",
  "subject_teaching",
  "non_teaching",
  "unclear",
]);

const BlindLabelSchema = z
  .object({
    confidence: z.enum(["high", "medium", "low"]),
    evidence: z.string(),
    label: ClassificationLabelSchema,
    model: z.string(),
    passId: z.string(),
    promptVersion: z.string(),
    rationale: z.string(),
    reasoningEffort: z.string(),
  })
  .strict();

const ClassificationReviewCaseSchema = z
  .object({
    board: z.string(),
    company: z.string(),
    country: z.string(),
    description: z.string(),
    itemId: z.string(),
    labels: z.tuple([BlindLabelSchema, BlindLabelSchema]),
    sourceHash: z.string(),
    sourceUrl: z.string(),
    title: z.string(),
  })
  .strict()
  .refine(
    (reviewCase) => reviewCase.labels[0].label !== reviewCase.labels[1].label,
    {
      message:
        "Classification review cases must contain a genuine disagreement",
    }
  );

const ClassificationReviewCorpusSchema = z
  .object({
    cases: z.array(ClassificationReviewCaseSchema),
    corpusVersion: z.string(),
  })
  .strict();

export type ClassificationLabel = z.infer<typeof ClassificationLabelSchema>;
export type ClassificationReviewCase = z.infer<
  typeof ClassificationReviewCaseSchema
>;

const parsed = ClassificationReviewCorpusSchema.parse(corpusJson);

export const CLASSIFICATION_REVIEW_CASES = parsed.cases;
export const CLASSIFICATION_REVIEW_CORPUS_VERSION = parsed.corpusVersion;

const CASES_BY_ID = new Map(
  CLASSIFICATION_REVIEW_CASES.map((reviewCase) => [
    reviewCase.itemId,
    reviewCase,
  ])
);

export function readClassificationReviewCase(itemId: string) {
  return CASES_BY_ID.get(itemId) ?? null;
}
