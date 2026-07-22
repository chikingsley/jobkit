import { describe, expect, test } from "bun:test";
import {
  INVENTORY_JOB_MATERIAL_HASH_VERSION,
  inventoryJobContentHash,
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../src/features/inventory/content";
import type { InventoryJob } from "../../src/features/inventory/schema";

describe("inventory listing material", () => {
  test("keeps freshness and volatile date text outside the material hash", async () => {
    const initial = inventoryJob();
    const refreshed: InventoryJob = {
      ...initial,
      lastSeenAt: "2026-07-21T12:00:00.000Z",
      sourceDates: {
        ...initial.sourceDates,
        posted: {
          date: null,
          provenance: "unresolved",
          raw: "1 day ago",
        },
      },
    };

    expect(INVENTORY_JOB_MATERIAL_HASH_VERSION).toBe(1);
    expect(await inventoryJobMaterialHash(refreshed)).toBe(
      await inventoryJobMaterialHash(initial)
    );
    expect(await inventoryJobContentHash(refreshed)).not.toBe(
      await inventoryJobContentHash(initial)
    );
    expect(serializeInventoryJobMaterial(refreshed)).not.toContain(
      "lastSeenAt"
    );
    expect(serializeInventoryJobMaterial(refreshed)).not.toContain("1 day ago");
  });

  test("changes for material facts and normalized source dates", async () => {
    const initial = inventoryJob();
    const reorderedSegments: InventoryJob = {
      ...initial,
      marketSegments: ["school", "international_school"],
    };
    const normalizedDate: InventoryJob = {
      ...initial,
      sourceDates: {
        ...initial.sourceDates,
        posted: {
          date: "2026-07-20",
          provenance: "board-published",
          raw: "2026-07-20 08:30",
        },
      },
    };
    const changedTitle = { ...initial, title: "Senior English teacher" };
    const changedEmployer = { ...initial, employerId: "employer-43" };

    expect(await inventoryJobMaterialHash(reorderedSegments)).toBe(
      await inventoryJobMaterialHash(initial)
    );
    expect(await inventoryJobMaterialHash(normalizedDate)).not.toBe(
      await inventoryJobMaterialHash(initial)
    );
    expect(await inventoryJobMaterialHash(changedTitle)).not.toBe(
      await inventoryJobMaterialHash(initial)
    );
    expect(await inventoryJobMaterialHash(changedEmployer)).not.toBe(
      await inventoryJobMaterialHash(initial)
    );
  });
});

function inventoryJob(): InventoryJob {
  return {
    applyEmail: "jobs@example.test",
    applyUrl: "https://example.test/apply",
    board: "example-board",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 / month",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Manager",
    country: "Georgia",
    description: "Teach adult English learners in Tbilisi.",
    employerId: "employer-42",
    id: "example-board:42",
    lastSeenAt: "2026-07-20T12:00:00.000Z",
    location: "Tbilisi",
    marketSegments: ["international_school", "school"],
    salary: "$2,500-$3,000 / month",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unresolved", raw: "2 days ago" },
    },
    sourceReference: "42",
    sourceUrl: "https://example.test/jobs/42",
    title: "English teacher",
  };
}
