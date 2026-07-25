import type { InventoryJob } from "./schema";

export const INVENTORY_JOB_MATERIAL_HASH_VERSION = 1;

export function serializeInventoryJob(job: InventoryJob) {
  return JSON.stringify(job);
}

export function inventoryJobContentHash(job: InventoryJob) {
  return sha256(serializeInventoryJob(job));
}

export function inventoryJobMaterial(job: InventoryJob) {
  return {
    applyEmail: job.applyEmail,
    applyUrl: job.applyUrl,
    board: job.board,
    company: job.company,
    compensation: {
      amountMaximum: job.compensation.amountMaximum,
      amountMinimum: job.compensation.amountMinimum,
      confidence: job.compensation.confidence,
      currency: job.compensation.currency,
      display: job.compensation.display,
      period: job.compensation.period,
      qualifier: job.compensation.qualifier,
    },
    contactName: job.contactName,
    country: job.country,
    description: job.description,
    employerId: job.employerId,
    id: job.id,
    location: job.location,
    marketSegments: [...job.marketSegments].sort(),
    salary: job.salary,
    sourceDates: {
      expires: job.sourceDates.expires.date,
      posted: job.sourceDates.posted.date,
    },
    sourceReference: job.sourceReference,
    sourceUrl: job.sourceUrl,
    title: job.title,
  };
}

export function serializeInventoryJobMaterial(job: InventoryJob) {
  return JSON.stringify(inventoryJobMaterial(job));
}

export function inventoryJobMaterialHash(job: InventoryJob) {
  return sha256(serializeInventoryJobMaterial(job));
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
