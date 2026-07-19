import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readAgentConfig } from "../agent/config";
import { prepareInventorySnapshot, publishInventorySnapshot } from "./publish";

const { values: args } = parseArgs({
  options: {
    apply: { default: false, type: "boolean" },
    "batch-size": { default: "50", type: "string" },
    source: { type: "string" },
  },
});

const batchSize = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(args["batch-size"]);
const sourcePath = args.source
  ? resolve(args.source)
  : resolve(import.meta.dir, "../../../job-search/job-data/jobs.sqlite");
const snapshot = await prepareInventorySnapshot(sourcePath);

if (!args.apply) {
  console.log(
    JSON.stringify({
      active: snapshot.active,
      batchCount: Math.ceil(snapshot.jobs.length / batchSize),
      batchSize,
      closed: snapshot.closed,
      economics: snapshot.economics,
      mode: "dry-run",
      snapshotKey: snapshot.snapshotKey,
      total: snapshot.total,
    })
  );
  process.exit(0);
}

const result = await publishInventorySnapshot({
  batchSize,
  config: await readAgentConfig(),
  onProgress(progress) {
    console.log(JSON.stringify(progress));
  },
  snapshot,
  sourceId: "job-search-sqlite",
  sourceName: "Job search source inventory",
});
console.log(
  JSON.stringify({
    economics: snapshot.economics,
    result: result.result,
    snapshotKey: result.snapshotKey,
  })
);
