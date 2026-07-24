import type { Compensation } from "../../src/features/jobs/types";
import { excluded, getDb } from "../db/client";
import { jobListings, userListingStates } from "../db/schema/jobs";
import type { JobImport } from "../schemas";

export async function upsertJob(
  db: D1Database,
  job: JobImport,
  timestamp: string
) {
  await getDb(db)
    .insert(jobListings)
    .values({
      applyUrl: job.applyUrl,
      board: job.board,
      company: job.company,
      contactName: job.contactName,
      country: job.country,
      description: job.description,
      employerId: job.employerId,
      firstSeenAt: timestamp,
      id: job.id,
      location: job.location,
      marketSegmentsJson: JSON.stringify(job.marketSegments),
      messageRoute:
        job.opportunityScope === "multi_position"
          ? "multi_position"
          : job.messageRoute,
      opportunityScope: job.opportunityScope,
      salary: job.salary,
      sourceReference: job.sourceReference,
      sourceUrl: job.sourceUrl,
      title: job.title,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      set: {
        applyUrl: excluded(jobListings.applyUrl),
        company: excluded(jobListings.company),
        contactName: excluded(jobListings.contactName),
        country: excluded(jobListings.country),
        description: excluded(jobListings.description),
        employerId: excluded(jobListings.employerId),
        location: excluded(jobListings.location),
        marketSegmentsJson: excluded(jobListings.marketSegmentsJson),
        messageRoute: excluded(jobListings.messageRoute),
        opportunityScope: excluded(jobListings.opportunityScope),
        salary: excluded(jobListings.salary),
        sourceReference: excluded(jobListings.sourceReference),
        sourceUrl: excluded(jobListings.sourceUrl),
        title: excluded(jobListings.title),
        updatedAt: excluded(jobListings.updatedAt),
      },
      target: jobListings.id,
    })
    .run();
}

export async function upsertUserJob(
  db: D1Database,
  userId: string,
  jobId: string,
  priority: number,
  timestamp: string
): Promise<string> {
  const row = await getDb(db)
    .insert(userListingStates)
    .values({
      createdAt: timestamp,
      id: crypto.randomUUID(),
      jobId,
      priority,
      status: "new",
      updatedAt: timestamp,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        priority: excluded(userListingStates.priority),
        updatedAt: excluded(userListingStates.updatedAt),
      },
      target: [userListingStates.userId, userListingStates.jobId],
    })
    .returning({ id: userListingStates.id })
    .get();
  if (!row) {
    throw new Error("User job could not be saved");
  }
  return row.id;
}

export function compensationFromRow(
  row: Record<string, unknown>
): Compensation {
  return {
    amountMax: nullableNumber(row.compensation_amount_max),
    amountMin: nullableNumber(row.compensation_amount_min),
    confidence: String(
      row.compensation_confidence
    ) as Compensation["confidence"],
    currency: nullableString(row.compensation_currency),
    display: String(row.compensation_display),
    notes: JSON.parse(String(row.compensation_notes_json)) as string[],
    period: nullableString(row.compensation_period) as Compensation["period"],
    qualifier: nullableString(
      row.compensation_qualifier
    ) as Compensation["qualifier"],
    source: String(row.compensation_source) as Compensation["source"],
  };
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}
