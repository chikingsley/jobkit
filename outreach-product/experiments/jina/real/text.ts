import { createHash } from "node:crypto";

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const WWW_PREFIX_PATTERN = /^www\./u;

export function stableOrder<T>(values: T[], key: (value: T) => string) {
  return values.toSorted((left, right) =>
    digest(key(left)).localeCompare(digest(key(right)))
  );
}

export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function tokenSet(value: string) {
  return new Set(normalizeText(value).match(TOKEN_PATTERN) ?? []);
}

export function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname
      .toLocaleLowerCase("en")
      .replace(WWW_PREFIX_PATTERN, "");
  } catch {
    return "";
  }
}

export function domainMatches(actualUrl: string, expectedDomain: string) {
  const actual = domainFromUrl(actualUrl);
  return actual === expectedDomain || actual.endsWith(`.${expectedDomain}`);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return -1;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue ** 2;
    rightNorm += rightValue ** 2;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
