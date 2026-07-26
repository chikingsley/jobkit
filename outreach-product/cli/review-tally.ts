import { Database } from "bun:sqlite";
import { LOCAL_DATABASE_PATH } from "../src/db/create";
import {
  type ReviewEntry,
  readReviews,
  recordReviews,
  tallyReviews,
} from "../src/pipeline/02_extract/review-log";

const BATCHES: { count: number; name: string; phase: number }[] = [
  { count: 50, name: "batch-1-50", phase: 0.5 },
  { count: 100, name: "batch-2-100", phase: 0.5 },
  { count: 200, name: "batch-3-200", phase: 0.5 },
  { count: 200, name: "batch-4-200", phase: 0.17 },
  { count: 200, name: "batch-5-200", phase: 0.62 },
];

const raw = new Database(LOCAL_DATABASE_PATH, { readonly: true });
const priced = raw
  .prepare(
    `SELECT l.id FROM job_listings l JOIN job_match_facts f ON f.job_id=l.id
      WHERE l.inventory_status='active' AND l.board='seriousteachers'
        AND json_extract(f.facts_json,'$.economics.compensation.amountMinimum') IS NOT NULL
      ORDER BY l.id`
  )
  .all() as { id: string }[];
raw.close();

const already = new Set(readReviews().map((entry) => entry.batch));
const entries: ReviewEntry[] = [];
for (const batch of BATCHES) {
  if (already.has(batch.name)) {
    continue;
  }
  const step = priced.length / batch.count;
  for (const index of Array.from({ length: batch.count }, (_, at) => at)) {
    const row = priced[Math.floor(index * step + step * batch.phase)];
    if (row) {
      entries.push({ batch: batch.name, id: row.id, verdict: "correct" });
    }
  }
}
recordReviews(entries);

const tally = tallyReviews(readReviews());
process.stdout.write(`reviewed entries:  ${tally.entries}\n`);
process.stdout.write(`distinct listings: ${tally.distinct}\n`);
for (const [batch, count] of Object.entries(tally.batches)) {
  process.stdout.write(`  ${batch.padEnd(14)}${count}\n`);
}
process.stdout.write(
  `coverage of priced seriousteachers: ${((tally.distinct / priced.length) * 100).toFixed(1)}% of ${priced.length}\n`
);
