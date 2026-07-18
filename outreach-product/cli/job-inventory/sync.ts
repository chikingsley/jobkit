import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSourceInventory } from "./source";
import { inventorySql } from "./sql";

interface WranglerResult<Row> {
  results: Row[];
  success: boolean;
}

const remote = process.argv.includes("--remote");
const databaseName = "jobkit-outreach";
const sourcePath = resolve(
  import.meta.dir,
  "../../../job-search/job-data/jobs.sqlite"
);
const inventory = readSourceInventory(sourcePath);
const economics = {
  hourly: inventory.jobs.filter((job) => job.compensation.period === "hour")
    .length,
  monthly: inventory.jobs.filter((job) => job.compensation.period === "month")
    .length,
  structured: inventory.jobs.filter(
    (job) =>
      job.compensation.amountMinimum !== null ||
      job.compensation.amountMaximum !== null
  ).length,
};

if (!remote) {
  console.log(
    JSON.stringify({
      active: inventory.active,
      closed: inventory.closed,
      economics,
      mode: "dry-run",
      total: inventory.total,
    })
  );
  process.exit(0);
}

const users = wranglerQuery<{ email: string; id: string }>(
  databaseName,
  "SELECT id,email FROM users ORDER BY created_at;"
);
if (users.length !== 1) {
  throw new Error(
    `Inventory sync expected one JobKit account and found ${users.length}`
  );
}
const [user] = users;
if (!user) {
  throw new Error("Inventory sync could not find the JobKit account");
}

const timestamp = new Date().toISOString();
const sqlPath = `/tmp/jobkit-inventory-${Date.now()}.sql`;
await writeFile(sqlPath, inventorySql(inventory.jobs, user.id, timestamp));
try {
  run([
    "bunx",
    "wrangler",
    "d1",
    "execute",
    databaseName,
    "--remote",
    "--file",
    sqlPath,
    "--yes",
  ]);
} finally {
  await unlink(sqlPath).catch(() => undefined);
}

const [verified] = wranglerQuery<{
  jobs: number;
  routes: number;
  user_jobs: number;
}>(
  databaseName,
  `SELECT
     (SELECT COUNT(*) FROM jobs) jobs,
     (SELECT COUNT(*) FROM user_jobs WHERE user_id=${sql(user.id)}) user_jobs,
     (SELECT COUNT(*) FROM application_routes) routes;`
);
console.log(
  JSON.stringify({
    ...verified,
    account: user.email,
    activeSourceJobs: inventory.active,
    closedSourceJobs: inventory.closed,
    economics,
    sourceJobs: inventory.total,
  })
);

function wranglerQuery<Row>(database: string, command: string): Row[] {
  const result = run([
    "bunx",
    "wrangler",
    "d1",
    "execute",
    database,
    "--remote",
    "--json",
    "--command",
    command,
  ]);
  const payload = JSON.parse(result) as WranglerResult<Row>[];
  const [first] = payload;
  if (!first?.success) {
    throw new Error("D1 query failed");
  }
  return first.results;
}

function run(command: string[]) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("A command is required");
  }
  const result = spawnSync(executable, args, {
    cwd: resolve(import.meta.dir, "../.."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`${command.slice(0, 4).join(" ")} failed`);
  }
  return result.stdout;
}

function sql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
