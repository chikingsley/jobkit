import type { InventoryJob } from "./schema";

export function serializeInventoryJob(job: InventoryJob) {
  return JSON.stringify(job);
}

export function inventoryJobContentHash(job: InventoryJob) {
  return sha256(serializeInventoryJob(job));
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
