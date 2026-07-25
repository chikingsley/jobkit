import type { TestLabCase } from "../../../src/test-lab/corpus";

const OCR_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

export interface TestLabMetrics {
  checks: Array<{ label: string; passed: boolean }>;
  exact: boolean;
  passed: boolean;
  score: number;
}

export function scoreTestLabOutput(
  testCase: TestLabCase,
  output: unknown
): TestLabMetrics {
  const result = asRecord(output);
  switch (testCase.capability) {
    case "classification":
      return exactScalar("label", testCase.expected, result);
    case "matching":
      return exactScalar("decision", testCase.expected, result);
    case "deduplication":
      return exactScalar("nearestId", testCase.expected, result);
    case "reranking":
      return scoreRanking(testCase.expected, result);
    case "extraction":
      return scoreExtraction(testCase.expected, result);
    case "revision":
      return scoreRequiredAndForbidden(
        testCase.expected,
        String(result.message ?? "")
      );
    case "reader":
    case "search":
    case "deepsearch":
      return scoreResearch(testCase.expected, result);
    default:
      return emptyMetrics("Unsupported test capability");
  }
}

export function scoreDocumentBenchmark(
  expectedText: string,
  actualText: string
) {
  const base = {
    actualCharacters: actualText.length,
    expectedCharacters: expectedText.length,
  };
  if (!expectedText.trim()) {
    return base;
  }
  const expectedTokens = tokenizeOcrText(expectedText);
  const actualTokens = tokenizeOcrText(actualText);
  const expectedCounts = countTokens(expectedTokens);
  const actualCounts = countTokens(actualTokens);
  let overlap = 0;
  for (const [token, count] of expectedCounts) {
    overlap += Math.min(count, actualCounts.get(token) ?? 0);
  }
  const precision = actualTokens.length > 0 ? overlap / actualTokens.length : 0;
  const recall =
    expectedTokens.length > 0 ? overlap / expectedTokens.length : 0;
  const tokenF1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  const exact = expectedText.trim() === actualText.trim();
  return { ...base, exact, passed: exact, score: tokenF1, tokenF1 };
}

function exactScalar(
  key: string,
  expected: Record<string, unknown>,
  output: Record<string, unknown>
): TestLabMetrics {
  const passed = normalize(output[key]) === normalize(expected[key]);
  return {
    checks: [{ label: `${key} matches`, passed }],
    exact: passed,
    passed,
    score: passed ? 1 : 0,
  };
}

function scoreRanking(
  expected: Record<string, unknown>,
  output: Record<string, unknown>
): TestLabMetrics {
  const expectedIds = stringArray(expected.orderedIds);
  const actualIds = stringArray(output.orderedIds);
  if (expectedIds.length === 0) {
    return emptyMetrics("Ground-truth ranking is empty");
  }
  const positionalScores = expectedIds.map((id, expectedIndex) => {
    const actualIndex = actualIds.indexOf(id);
    if (actualIndex < 0) {
      return 0;
    }
    return Math.max(
      0,
      1 - Math.abs(actualIndex - expectedIndex) / expectedIds.length
    );
  });
  const score = average(positionalScores);
  const topResultCorrect = actualIds[0] === expectedIds[0];
  const exact = arraysEqual(
    actualIds.slice(0, expectedIds.length),
    expectedIds
  );
  return {
    checks: [
      { label: "top result matches", passed: topResultCorrect },
      { label: "complete order matches", passed: exact },
      {
        label: "all expected candidates returned",
        passed: expectedIds.every((id) => actualIds.includes(id)),
      },
    ],
    exact,
    passed: topResultCorrect && score >= 0.75,
    score,
  };
}

function scoreExtraction(
  expected: Record<string, unknown>,
  output: Record<string, unknown>
): TestLabMetrics {
  const expectedValues = asRecord(expected.values);
  const actualValues = asRecord(output.values);
  const checks = Object.entries(expectedValues).map(([field, value]) => ({
    label: `${field} matches source wording`,
    passed: normalize(actualValues[field]) === normalize(value),
  }));
  const score = checks.length
    ? checks.filter((check) => check.passed).length / checks.length
    : 0;
  return {
    checks,
    exact: score === 1,
    passed: score === 1,
    score,
  };
}

function scoreRequiredAndForbidden(
  expected: Record<string, unknown>,
  value: string
): TestLabMetrics {
  const normalizedValue = normalize(value);
  const requiredChecks = stringArray(expected.requiredPhrases).map(
    (phrase) => ({
      label: `contains “${phrase}”`,
      passed: normalizedValue.includes(normalize(phrase)),
    })
  );
  const forbiddenChecks = stringArray(expected.forbiddenPhrases).map(
    (phrase) => ({
      label: `omits “${phrase}”`,
      passed: !normalizedValue.includes(normalize(phrase)),
    })
  );
  const checks = [...requiredChecks, ...forbiddenChecks];
  const score = checks.length
    ? checks.filter((check) => check.passed).length / checks.length
    : 0;
  return { checks, exact: score === 1, passed: score === 1, score };
}

function scoreResearch(
  expected: Record<string, unknown>,
  output: Record<string, unknown>
): TestLabMetrics {
  const serialized = JSON.stringify(output);
  const phraseMetrics = scoreRequiredAndForbidden(expected, serialized);
  const domainChecks = stringArray(expected.requiredDomains).map((domain) => ({
    label: `cites ${domain}`,
    passed: normalize(serialized).includes(normalize(domain)),
  }));
  const checks = [...phraseMetrics.checks, ...domainChecks];
  const score = checks.length
    ? checks.filter((check) => check.passed).length / checks.length
    : 0;
  return { checks, exact: score === 1, passed: score === 1, score };
}

function emptyMetrics(label: string): TestLabMetrics {
  return {
    checks: [{ label, passed: false }],
    exact: false,
    passed: false,
    score: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replaceAll(/\s+/gu, " ");
}

function average(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function arraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function tokenizeOcrText(value: string) {
  return value.toLocaleLowerCase("en").match(OCR_TOKEN_PATTERN) ?? [];
}

function countTokens(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
