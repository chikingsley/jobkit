import { readFileSync } from "node:fs";
import { submitApplication } from "../src/pipeline/06_deliver/submit";

const ENV_PATH = `${process.env.HOME}/github/jobkit/.env`;
const PAIR = /^([A-Z_]+)=(.*)$/u;

function credentials() {
  const values = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const found = PAIR.exec(line.trim());
    if (found?.[1] && found[2] !== undefined) {
      values.set(found[1], found[2].replace(/^["']|["']$/gu, ""));
    }
  }
  const email = values.get("SERIOUSTEACHERS_EMAIL");
  const password = values.get("SERIOUSTEACHERS_PASSWORD");
  if (!(email && password)) {
    throw new Error(`SERIOUSTEACHERS_EMAIL/PASSWORD missing from ${ENV_PATH}`);
  }
  return { email, password };
}

const [jobId, employerId, ...rest] = process.argv.slice(2);
if (!(jobId && employerId)) {
  process.stdout.write(
    "usage: bun cli/apply.ts <jobId> <employerId> [message file]\n"
  );
  process.exit(1);
}
const comments = readFileSync(rest[0] ?? "/dev/stdin", "utf8").trim();
process.stdout.write(
  `applying to ${jobId}/${employerId} with ${comments.length} chars\n`
);
const outcome = await submitApplication(credentials(), {
  comments,
  employerId,
  jobId,
});
process.stdout.write(`${JSON.stringify(outcome, null, 1)}\n`);
process.exit(outcome.status === "failed" ? 1 : 0);
