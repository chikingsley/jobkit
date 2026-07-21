import { TestLabError } from "../errors";
import type { JinaDocumentCandidate } from "./contracts";

export function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TestLabError(`Test case is missing ${label}`, 400);
  }
  return value;
}

export function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

export function requiredStringArray(value: unknown, label: string) {
  const values = optionalStringArray(value);
  if (values.length === 0) {
    throw new TestLabError(`Test case is missing ${label}`, 400);
  }
  return values;
}

export function documentCandidates(value: unknown): JinaDocumentCandidate[] {
  if (!Array.isArray(value)) {
    throw new TestLabError("Test case candidates are invalid", 400);
  }
  const candidates = value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.text === "string"
      ? [{ id: record.id, text: record.text }]
      : [];
  });
  if (candidates.length === 0) {
    throw new TestLabError("Test case candidates are empty", 400);
  }
  return candidates;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}
