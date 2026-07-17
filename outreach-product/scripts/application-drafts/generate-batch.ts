// Campaign batch: stage drafts for a list of jobs via the runner-scoped
// generate endpoint. Drafts land in the review queue; nothing is approved or
// sent. Recurring campaign tool.
//
// Usage: bun --env-file=.dev.vars scripts/application-drafts/generate-batch.ts --ids a,b,c
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { ids: { default: "", type: "string" } },
});
const runnerToken = process.env.JOBKIT_RUNNER_TOKEN ?? "";
if (!(runnerToken && args.ids)) {
  throw new Error("JOBKIT_RUNNER_TOKEN and --ids are required");
}
const base =
  process.env.JOBKIT_URL ?? "https://outreach-product.peacockery.studio";

const ids = args.ids
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
let generated = 0;
for (const id of ids) {
  const startedAt = Date.now();
  // biome-ignore lint/performance/noAwaitInLoops: Draft generation is deliberately serialized to avoid model-provider bursts.
  const response = await fetch(
    `${base}/api/jobs/${encodeURIComponent(id)}/generate`,
    { headers: { authorization: `Bearer ${runnerToken}` }, method: "POST" }
  );
  const body = (await response.json()) as { message?: string };
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (response.ok) {
    generated += 1;
    console.log(`OK ${id} (${seconds}s): ${body.message ?? ""}`);
  } else {
    console.error(
      `FAIL ${id} (${seconds}s): ${response.status} ${JSON.stringify(body).slice(0, 200)}`
    );
  }
}
console.log(`Generated ${generated}/${ids.length} drafts`);
if (generated !== ids.length) {
  process.exitCode = 1;
}
