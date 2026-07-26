import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const REVIEW_LOG_PATH = ".jobkit/reviewed.jsonl";

export interface ReviewEntry {
  batch: string;
  id: string;
  verdict: "correct" | "wrong" | "unpriced";
}

export interface ReviewTally {
  batches: Record<string, number>;
  boards: Record<string, number>;
  distinct: number;
  entries: number;
  wrong: number;
}

export function recordReviews(
  entries: ReviewEntry[],
  path = REVIEW_LOG_PATH
): number {
  if (entries.length === 0) {
    return 0;
  }
  appendFileSync(
    path,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
  );
  return entries.length;
}

export function readReviews(path = REVIEW_LOG_PATH): ReviewEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ReviewEntry];
      } catch {
        return [];
      }
    });
}

export function tallyReviews(entries: ReviewEntry[]): ReviewTally {
  const seen = new Set<string>();
  const batches: Record<string, number> = {};
  const boards: Record<string, number> = {};
  let wrong = 0;
  for (const entry of entries) {
    seen.add(entry.id);
    batches[entry.batch] = (batches[entry.batch] ?? 0) + 1;
    const [board] = entry.id.split(":");
    if (board) {
      boards[board] = (boards[board] ?? 0) + 1;
    }
    if (entry.verdict === "wrong") {
      wrong += 1;
    }
  }
  return {
    batches,
    boards,
    distinct: seen.size,
    entries: entries.length,
    wrong,
  };
}
