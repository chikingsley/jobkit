import type { InventoryJob } from "../../features/inventory/schema";
import { jobSourceHash } from "../02_extract/ai/job-fact-extraction";
import {
  readJobListingSource,
  recordJobMatchFacts,
} from "../02_extract/facts-records";
import {
  DETERMINISTIC_EXTRACTION_MODEL,
  DETERMINISTIC_EXTRACTION_PROVIDER,
  matchFactsFromSourceFields,
  supportsDeterministicExtraction,
} from "../02_extract/from-source-fields";

export async function extractFactsFromSourceFields(
  db: D1Database,
  job: InventoryJob
) {
  if (!(job.fields && supportsDeterministicExtraction(job.board))) {
    return;
  }
  const facts = matchFactsFromSourceFields(job.board, job.fields);
  if (!facts) {
    return;
  }
  try {
    const stored = await readJobListingSource(db, job.id);
    await recordJobMatchFacts(db, {
      facts,
      jobId: job.id,
      modelId: DETERMINISTIC_EXTRACTION_MODEL,
      provider: DETERMINISTIC_EXTRACTION_PROVIDER,
      sourceHash: await jobSourceHash(stored),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "deterministic_extraction_skipped",
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}
