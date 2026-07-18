// Prepare selected applications through the runner-scoped generation endpoint.
// Every generated draft remains in review; this command never approves or sends.
//
// Usage: bun run jobkit -- applications prepare --ids a,b,c
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
let prepared = 0;
for (const id of ids) {
  const startedAt = Date.now();
  // biome-ignore lint/performance/noAwaitInLoops: Application preparation is deliberately serialized to avoid model-provider bursts.
  const response = await fetch(
    `${base}/api/jobs/${encodeURIComponent(id)}/generate`,
    { headers: { authorization: `Bearer ${runnerToken}` }, method: "POST" }
  );
  const body = (await response.json()) as { message?: string };
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (response.ok) {
    prepared += 1;
    console.log(`OK ${id} (${seconds}s): ${body.message ?? ""}`);
  } else {
    console.error(
      `FAIL ${id} (${seconds}s): ${response.status} ${JSON.stringify(body).slice(0, 200)}`
    );
  }
}
console.log(`Prepared ${prepared}/${ids.length} applications`);
if (prepared !== ids.length) {
  process.exitCode = 1;
}
