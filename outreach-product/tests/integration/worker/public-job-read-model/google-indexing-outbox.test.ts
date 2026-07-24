import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  appendTerminalDecision,
  publishCatalog,
} from "./support/appendterminaldecision";
import { seedPublishedJob, seedSource, testEnv } from "./support/model";

interface IndexingEventRow {
  catalog_version: string;
  event_type: string;
  public_job_id: string;
}

const indexingEvents = () =>
  testEnv.DB.prepare(
    `SELECT public_job_id,event_type,catalog_version
       FROM google_indexing_events
      ORDER BY catalog_version,public_job_id,event_type`
  ).all<IndexingEventRow>();

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("google indexing outbox", () => {
  it("derives events from opened and closed spans only", async () => {
    const source = "indexing-outbox";
    await seedSource(source);
    const retained = await seedPublishedJob({ index: 801, source });
    const removed = await seedPublishedJob({ index: 802, source });
    await publishCatalog("indexing-first", [
      retained.publicId,
      removed.publicId,
    ]);
    await expect(indexingEvents()).resolves.toMatchObject({
      results: [
        {
          catalog_version: "catalog:indexing-first",
          event_type: "URL_UPDATED",
          public_job_id: retained.publicId,
        },
        {
          catalog_version: "catalog:indexing-first",
          event_type: "URL_UPDATED",
          public_job_id: removed.publicId,
        },
      ],
    });

    // The retained member keeps its span, so the next activation emits only
    // the removed member's deletion: the outbox write set is O(changed).
    await appendTerminalDecision(removed.publicId, "closed", null);
    await publishCatalog("indexing-second", [retained.publicId]);
    const events = await indexingEvents();
    expect(
      events.results.filter(
        (event) => event.catalog_version === "catalog:indexing-second"
      )
    ).toEqual([
      {
        catalog_version: "catalog:indexing-second",
        event_type: "URL_DELETED",
        public_job_id: removed.publicId,
      },
    ]);
    expect(events.results).toHaveLength(3);
  });
});
