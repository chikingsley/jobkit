// Import one immutable user message foundation and optional calibration votes.
//
// Usage:
//   bun run jobkit -- messages import-foundation \
//     --email candidate@example.com --foundation foundation.json \
//     [--samples samples.json --votes votes.json --source fable-review] \
//     [--backfill-model mistral-medium-latest] [--remote]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const FoundationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  templates: z.object({
    advertised_long_general: z.string().min(1),
    advertised_long_young: z.string().min(1),
    advertised_short: z.string().min(1),
    multi_position: z.string().min(1),
    school_outreach_long: z.string().min(1),
    school_outreach_short: z.string().min(1),
  }),
  version: z.number().int().positive(),
  voiceRules: z.array(z.string().min(1)),
});

const SampleSchema = z.object({
  jobId: z.string().min(1),
  message: z.string().min(1),
  route: z.enum(["advertised_position", "multi_position", "school_outreach"]),
});

const VoteSchema = z.object({
  jobId: z.string().min(1),
  note: z.string(),
  route: z.enum(["advertised_position", "multi_position", "school_outreach"]),
  verdict: z.enum(["yes", "no"]),
  votedAt: z.string().min(1),
});

const { values: args } = parseArgs({
  options: {
    "backfill-model": { default: "", type: "string" },
    email: { type: "string" },
    foundation: { type: "string" },
    remote: { default: false, type: "boolean" },
    samples: { default: "", type: "string" },
    source: { default: "product-calibration", type: "string" },
    votes: { default: "", type: "string" },
  },
});

if (!(args.email && args.foundation)) {
  throw new Error("--email and --foundation are required");
}
const { email } = args;
if (Boolean(args.samples) !== Boolean(args.votes)) {
  throw new Error("--samples and --votes must be supplied together");
}

const foundation = FoundationSchema.parse(
  JSON.parse(readFileSync(resolve(args.foundation), "utf8"))
);
const samples = args.samples
  ? z
      .array(SampleSchema)
      .parse(JSON.parse(readFileSync(resolve(args.samples), "utf8")))
  : [];
const votes = args.votes
  ? z
      .array(VoteSchema)
      .parse(JSON.parse(readFileSync(resolve(args.votes), "utf8")))
  : [];

const quoteSql = (value: string) => value.replaceAll("'", "''");
const sampleFor = (jobId: string, route: string) =>
  samples.findLast(
    (sample) => sample.jobId === jobId && sample.route === route
  );

const statements = [
  `INSERT INTO user_message_foundations
    (id,user_id,version,name,status,voice_rules_json,templates_json,created_at,activated_at)
   SELECT '${quoteSql(foundation.id)}',id,${foundation.version},
          '${quoteSql(foundation.name)}','active',
          '${quoteSql(JSON.stringify(foundation.voiceRules))}',
          '${quoteSql(JSON.stringify(foundation.templates))}',
          datetime('now'),datetime('now')
     FROM users WHERE email='${quoteSql(args.email)}'
   ON CONFLICT(id) DO NOTHING;`,
  ...votes.map((vote, index) => {
    const sample = sampleFor(vote.jobId, vote.route);
    if (!sample) {
      throw new Error(
        `No rendered sample for ${vote.jobId}/${vote.route} at vote ${index}`
      );
    }
    const decisionId = `calibration:${createHash("sha256")
      .update(
        `${args.source}:${index}:${vote.votedAt}:${vote.jobId}:${vote.route}`
      )
      .digest("hex")
      .slice(0, 32)}`;
    return `INSERT INTO user_message_calibration_decisions
      (id,user_id,foundation_id,job_id,route,rendered_message,verdict,note,source,decided_at)
     SELECT '${decisionId}',u.id,'${quoteSql(foundation.id)}',
            '${quoteSql(vote.jobId)}','${quoteSql(vote.route)}',
            '${quoteSql(sample.message)}','${quoteSql(vote.verdict)}',
            '${quoteSql(vote.note)}','${quoteSql(args.source)}',
            '${quoteSql(vote.votedAt)}'
       FROM users u WHERE u.email='${quoteSql(email)}'
     ON CONFLICT(id) DO NOTHING;`;
  }),
];

if (args["backfill-model"]) {
  statements.push(
    `UPDATE application_drafts
        SET message_foundation_id='${quoteSql(foundation.id)}',
            message_template_key=(
              SELECT CASE
                WHEN j.opportunity_scope='multi_position'
                  OR j.message_route='multi_position' THEN 'multi_position'
                WHEN j.message_route='school_outreach' THEN
                  CASE WHEN EXISTS (
                    SELECT 1 FROM application_routes ar
                     WHERE ar.job_id=j.id AND ar.kind='email' AND ar.status='active'
                  ) THEN 'school_outreach_long' ELSE 'school_outreach_short' END
                WHEN NOT EXISTS (
                  SELECT 1 FROM application_routes ar
                   WHERE ar.job_id=j.id AND ar.kind='email' AND ar.status='active'
                ) THEN 'advertised_short'
                WHEN EXISTS (
                  SELECT 1 FROM job_match_facts f,json_each(f.facts_json,'$.audiences') a
                   WHERE f.job_id=j.id
                ) AND NOT EXISTS (
                  SELECT 1 FROM job_match_facts f,json_each(f.facts_json,'$.audiences') a
                   WHERE f.job_id=j.id
                     AND json_extract(a.value,'$.value') NOT IN ('preschool','primary')
                ) THEN 'advertised_long_young'
                ELSE 'advertised_long_general'
              END
                FROM user_jobs uj JOIN jobs j ON j.id=uj.job_id
               WHERE uj.id=application_drafts.user_job_id
            )
      WHERE model_id='${quoteSql(args["backfill-model"])}'
        AND message_foundation_id IS NULL;`
  );
}

const sqlPath = join(tmpdir(), `message-foundation-${Date.now()}.sql`);
writeFileSync(sqlPath, statements.join("\n"));
const result = spawnSync(
  "bunx",
  [
    "wrangler",
    "d1",
    "execute",
    "jobkit-outreach",
    ...(args.remote ? ["--remote"] : ["--local"]),
    "--yes",
    "--file",
    sqlPath,
  ],
  { cwd: resolve(import.meta.dir, "../.."), stdio: "inherit" }
);
unlinkSync(sqlPath);
process.exit(result.status ?? 1);
