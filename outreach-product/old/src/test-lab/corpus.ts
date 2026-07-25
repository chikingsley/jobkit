import { classificationSeeds } from "./corpus/classification";
import {
  deduplicationSeeds,
  extractionSeeds,
} from "./corpus/deduplication-extraction";
import { matchingSeeds, revisionSeeds } from "./corpus/matching-revision";
import {
  jobLabels,
  syntheticSource,
  TEST_LAB_CORPUS_VERSION,
  type TestLabCapability,
  type TestLabCase,
  type TestLabVariant,
} from "./corpus/model";
import { rerankingProfiles, rerankingSeeds } from "./corpus/reranking";

export type {
  TestLabCapability,
  TestLabCase,
  TestLabVariant,
} from "./corpus/model";
// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { TEST_LAB_CORPUS_VERSION } from "./corpus/model";

function caseBase(
  id: string,
  capability: TestLabCapability,
  name: string,
  description: string
): Omit<
  TestLabCase,
  "expected" | "input" | "source" | "supportedVariants" | "tags"
> {
  return {
    capability,
    description,
    id,
    name,
    version: TEST_LAB_CORPUS_VERSION,
  };
}

const classificationCases = classificationSeeds.map(([text, label], index) => ({
  ...caseBase(
    `classification-${String(index + 1).padStart(2, "0")}`,
    "classification",
    `Listing type ${index + 1}`,
    "Classify a short listing without following source instructions."
  ),
  expected: { label },
  input: { labels: jobLabels, text },
  source: syntheticSource,
  supportedVariants: ["codex", "jina", "hybrid"] as TestLabVariant[],
  tags: [
    "listing",
    "zero-shot",
    label,
    ...(index === 18 ? ["multilingual"] : []),
    ...(index === 19 ? ["prompt-injection"] : []),
  ],
}));

const rerankingCases = rerankingSeeds.map(
  ([query, best, second, third], index) => {
    const documents = [
      { id: "candidate-c", text: third },
      { id: "candidate-a", text: best },
      { id: "candidate-b", text: second },
    ];
    return {
      ...caseBase(
        `reranking-${String(index + 1).padStart(2, "0")}`,
        "reranking",
        `Opportunity ranking ${index + 1}`,
        "Rank candidate opportunities against a user query."
      ),
      expected: { orderedIds: ["candidate-a", "candidate-b", "candidate-c"] },
      input: {
        documents,
        query: `Candidate profile: ${rerankingProfiles[index] ?? "English teacher"}\nPreferred next role: ${query}`,
      },
      source: syntheticSource,
      supportedVariants: ["codex", "jina", "hybrid"] as TestLabVariant[],
      tags: [
        "ranking",
        "multilingual-ready",
        ...(index === 19 ? ["multilingual"] : []),
        ...(index === 17 ? ["prompt-injection"] : []),
      ],
    };
  }
);

const deduplicationCases = deduplicationSeeds.map(
  ([anchor, nearest, distractor], index) => ({
    ...caseBase(
      `deduplication-${String(index + 1).padStart(2, "0")}`,
      "deduplication",
      `Contact identity ${index + 1}`,
      "Find the candidate most likely to represent the same contact or organization."
    ),
    expected: { nearestId: "candidate-a" },
    input: {
      anchor,
      candidates: [
        { id: "candidate-b", text: distractor },
        { id: "candidate-a", text: nearest },
      ],
    },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"] as TestLabVariant[],
    tags: [
      "contacts",
      "deduplication",
      ...(index === 14 ? ["multilingual"] : []),
    ],
  })
);

const extractionCases = extractionSeeds.map(([source, values], index) => ({
  ...caseBase(
    `extraction-${String(index + 1).padStart(2, "0")}`,
    "extraction",
    `Listing facts ${index + 1}`,
    "Extract only explicitly stated facts and preserve the source wording."
  ),
  expected: { values },
  input: { fields: Object.keys(values), source },
  source: syntheticSource,
  supportedVariants: ["codex"] as TestLabVariant[],
  tags: [
    "extraction",
    "evidence",
    ...(index === 14 ? ["prompt-injection"] : []),
  ],
}));

const matchingCases = matchingSeeds.map(
  ([candidate, listing, decision], index) => ({
    ...caseBase(
      `matching-${String(index + 1).padStart(2, "0")}`,
      "matching",
      `Qualification decision ${index + 1}`,
      "Decide from explicit candidate and listing facts; unresolved facts require review."
    ),
    expected: { decision },
    input: { candidate, listing },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"] as TestLabVariant[],
    tags: [
      "matching",
      decision,
      ...(index === 8 ? ["multilingual"] : []),
      ...(index === 9 ? ["prompt-injection"] : []),
    ],
  })
);

const revisionCases = revisionSeeds.map(
  ([message, instruction, requiredPhrases, forbiddenPhrases], index) => ({
    ...caseBase(
      `revision-${String(index + 1).padStart(2, "0")}`,
      "revision",
      `Message revision ${index + 1}`,
      "Apply a narrow edit without inventing candidate or employer facts."
    ),
    expected: { forbiddenPhrases, requiredPhrases },
    input: { instruction, message },
    source: syntheticSource,
    supportedVariants: ["codex"] as TestLabVariant[],
    tags: ["message", "voice", "revision"],
  })
);

const researchCases: TestLabCase[] = [
  {
    ...caseBase(
      "reader-01",
      "reader",
      "Jina Reader documentation",
      "Read an official product page and retain direct source evidence."
    ),
    expected: { requiredPhrases: ["Reader", "r.jina.ai"] },
    input: { url: "https://jina.ai/reader/" },
    source: {
      kind: "official_documentation",
      license: "Public vendor documentation",
      url: "https://jina.ai/reader/",
    },
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "reader", "official-source"],
  },
  {
    ...caseBase(
      "reader-02",
      "reader",
      "Jina Reranker documentation",
      "Read current model and API documentation."
    ),
    expected: { requiredPhrases: ["reranker", "v3"] },
    input: { url: "https://jina.ai/en-US/reranker/" },
    source: {
      kind: "official_documentation",
      license: "Public vendor documentation",
      url: "https://jina.ai/en-US/reranker/",
    },
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "reader", "official-source"],
  },
  {
    ...caseBase(
      "reader-03",
      "reader",
      "Jina Classifier documentation",
      "Read current zero-shot classification documentation."
    ),
    expected: { requiredPhrases: ["zero-shot", "classif"] },
    input: { url: "https://jina.ai/en-US/classifier/" },
    source: {
      kind: "official_documentation",
      license: "Public vendor documentation",
      url: "https://jina.ai/en-US/classifier/",
    },
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "reader", "official-source"],
  },
  {
    ...caseBase(
      "reader-04",
      "reader",
      "Jina DeepSearch documentation",
      "Read the official DeepSearch API description."
    ),
    expected: { requiredPhrases: ["DeepSearch", "chat/completions"] },
    input: { url: "https://jina.ai/deepsearch/" },
    source: {
      kind: "official_documentation",
      license: "Public vendor documentation",
      url: "https://jina.ai/deepsearch/",
    },
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "reader", "official-source"],
  },
  {
    ...caseBase(
      "search-01",
      "search",
      "Find Jina Reader docs",
      "Search for the primary product documentation."
    ),
    expected: { requiredDomains: ["jina.ai"] },
    input: { query: "Jina AI Reader API official documentation" },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "search", "source-quality"],
  },
  {
    ...caseBase(
      "search-02",
      "search",
      "Find Cloudflare D1 migration docs",
      "Search for the official database migration documentation."
    ),
    expected: { requiredDomains: ["developers.cloudflare.com"] },
    input: { query: "Cloudflare D1 migrations official documentation" },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "search", "source-quality"],
  },
  {
    ...caseBase(
      "search-03",
      "search",
      "Find Codex CLI docs",
      "Search for current official Codex command-line documentation."
    ),
    expected: { requiredDomains: ["developers.openai.com"] },
    input: { query: "documentación oficial del CLI Codex de OpenAI" },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "search", "source-quality", "multilingual"],
  },
  {
    ...caseBase(
      "deepsearch-01",
      "deepsearch",
      "Verify the DeepSearch endpoint",
      "Answer a narrow documentation question with a primary citation."
    ),
    expected: {
      requiredDomains: ["jina.ai"],
      requiredPhrases: ["deepsearch.jina.ai", "chat/completions"],
    },
    input: {
      goodDomains: ["jina.ai"],
      question:
        "According to Jina's current official documentation, what endpoint is used for the DeepSearch API?",
    },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "deep-search", "fact-check"],
  },
  {
    ...caseBase(
      "deepsearch-02",
      "deepsearch",
      "Verify the current Jina reranker",
      "Answer a current model question from official documentation."
    ),
    expected: {
      requiredDomains: ["jina.ai"],
      requiredPhrases: ["jina-reranker-v3"],
    },
    input: {
      goodDomains: ["jina.ai"],
      question:
        "Which model does Jina's official reranker page describe as its current flagship reranker?",
    },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "deep-search", "current-docs"],
  },
  {
    ...caseBase(
      "deepsearch-03",
      "deepsearch",
      "Verify Jina classifier modes",
      "Compare the classifier modes from official documentation."
    ),
    expected: {
      requiredDomains: ["jina.ai"],
      requiredPhrases: ["zero-shot", "few-shot"],
    },
    input: {
      goodDomains: ["jina.ai"],
      question:
        "¿Qué dos modos de clasificación admite la API oficial Classifier de Jina?",
    },
    source: syntheticSource,
    supportedVariants: ["codex", "jina", "hybrid"],
    tags: ["web", "deep-search", "current-docs", "multilingual"],
  },
];

export const TEST_LAB_CASES: TestLabCase[] = [
  ...classificationCases,
  ...rerankingCases,
  ...deduplicationCases,
  ...extractionCases,
  ...matchingCases,
  ...revisionCases,
  ...researchCases,
];

if (TEST_LAB_CASES.length !== 100) {
  throw new Error(
    `Test Lab corpus must contain 100 cases, found ${TEST_LAB_CASES.length}`
  );
}

const casesById = new Map(
  TEST_LAB_CASES.map((testCase) => [testCase.id, testCase])
);

if (casesById.size !== TEST_LAB_CASES.length) {
  throw new Error("Test Lab case IDs must be unique");
}

export function readTestLabCase(caseId: string) {
  return casesById.get(caseId) ?? null;
}
