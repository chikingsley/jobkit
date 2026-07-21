import { z } from "zod";
import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { TestLabError } from "../errors";
import { JINA_API_BASE, jinaJson } from "./client";
import type { JinaExecutionResult } from "./contracts";
import { requiredString, requiredStringArray } from "./inputs";

const DEFAULT_CLASSIFICATION_MODEL = "jina-embeddings-v3";
export const CLASSIFICATION_LABEL_MODES = [
  "descriptive-v1",
  "concise-v1",
  "canonical",
] as const;
export type ClassificationLabelMode =
  (typeof CLASSIFICATION_LABEL_MODES)[number];
const UsageSchema = z
  .object({ total_tokens: z.number().nonnegative() })
  .passthrough();
const ClassifierResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          prediction: z.union([z.string(), z.record(z.string(), z.string())]),
          score: z.union([z.number(), z.record(z.string(), z.number())]),
        })
        .passthrough()
    ),
    usage: UsageSchema,
  })
  .passthrough();

export function classifyCase(
  env: AppEnv,
  testCase: TestLabCase,
  resultKey: string,
  model = DEFAULT_CLASSIFICATION_MODEL
) {
  return classifyText(
    env,
    {
      labels: requiredStringArray(
        testCase.input.labels,
        "classification labels"
      ),
      text: requiredString(testCase.input.text, "classification text"),
    },
    resultKey,
    model
  );
}

export function classifyMatchingCase(env: AppEnv, testCase: TestLabCase) {
  return classifyText(
    env,
    {
      labels: ["match", "review", "exclude"],
      text: `Candidate facts: ${requiredString(testCase.input.candidate, "candidate facts")}\nListing requirements: ${requiredString(testCase.input.listing, "listing requirements")}`,
    },
    "decision",
    DEFAULT_CLASSIFICATION_MODEL
  );
}

export async function classifyText(
  env: AppEnv,
  input: { labels: string[]; text: string },
  resultKey: string,
  model: string
) {
  const response = await classifyTexts(
    env,
    { labels: input.labels, texts: [input.text] },
    model
  );
  const [prediction] = response.predictions;
  if (!prediction) {
    throw new TestLabError("Jina did not return a classification", 502);
  }
  return {
    model: response.model,
    output: { [resultKey]: prediction.label, score: prediction.score },
    provenance: response.provenance,
    usage: response.usage,
  } satisfies JinaExecutionResult;
}

export async function classifyTexts(
  env: AppEnv,
  input: { labels: string[]; texts: string[] },
  model: string,
  labelMode: ClassificationLabelMode = "descriptive-v1"
) {
  const providerLabels = input.labels.map((label) => ({
    canonical: label,
    provider: providerLabel(label, labelMode),
  }));
  const response = await jinaJson(
    env,
    `${JINA_API_BASE}/classify`,
    {
      input: input.texts,
      labels: providerLabels.map((label) => label.provider),
      model,
    },
    ClassifierResponseSchema,
    30_000
  );
  const orderedPredictions = response.data.toSorted(
    (left, right) => left.index - right.index
  );
  if (orderedPredictions.length !== input.texts.length) {
    throw new TestLabError(
      "Jina returned an incomplete classifier result",
      502
    );
  }
  return {
    model,
    predictions: orderedPredictions.map((prediction) => {
      if (typeof prediction.prediction !== "string") {
        throw new TestLabError(
          "Jina returned an unsupported classifier result",
          502
        );
      }
      const label = providerLabels.find(
        (candidate) =>
          candidate.provider === prediction.prediction ||
          candidate.canonical === prediction.prediction
      )?.canonical;
      if (!label) {
        throw new TestLabError(
          "Jina returned an unknown classifier label",
          502
        );
      }
      return { label, score: prediction.score };
    }),
    provenance: {
      endpoint: `${JINA_API_BASE}/classify`,
      labelMode,
      provider: "jina",
    },
    usage: response.usage,
  };
}

function providerLabel(label: string, mode: ClassificationLabelMode) {
  if (mode === "canonical") {
    return label;
  }
  if (mode === "concise-v1") {
    return label.replaceAll("_", " ");
  }
  return `${label}: ${classificationLabelDescription(label)}`;
}

function classificationLabelDescription(label: string) {
  const descriptions: Record<string, string> = {
    english_teaching:
      "a role teaching English language, English literacy, EAP, IELTS, or conversational English",
    exclude: "an explicit required fact conflicts with the candidate facts",
    match: "all explicit required facts are satisfied by the candidate facts",
    non_teaching: "an education-sector role without classroom teaching duties",
    review: "one or more explicit required facts remain unresolved",
    subject_teaching:
      "a classroom role teaching a subject other than English language",
    unclear: "a listing whose teaching subject or actual role is not stated",
  };
  return descriptions[label] ?? label.replaceAll("_", " ");
}
