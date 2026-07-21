import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  JobContentAnalysisSchema,
} from "../../src/features/jobs/content-analysis";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import { jobSourceHash } from "../../worker/ai/job-fact-extraction";
import type {
  AnalysisCase,
  AnalysisRunResult,
  AnalysisTask,
} from "./contracts";
import { readAnalysisCases } from "./corpus";

interface BakeoffArtifact {
  cases: Array<Omit<AnalysisCase, "sourceUrl"> & { sourceUrl?: string }>;
  results: AnalysisRunResult[];
}

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    database: { type: "string" },
  },
  strict: true,
});
const artifactPath = resolve(values.artifact ?? latestArtifactPath());
const databasePath = resolve(values.database ?? localD1Path());
const artifact = JSON.parse(
  await readFile(artifactPath, "utf8")
) as BakeoffArtifact;
const corpusCases = new Map(
  readAnalysisCases(artifact.cases.length).map((item) => [item.id, item])
);
const prepared = await Promise.all(
  artifact.cases.map(async (artifactCase) => {
    const sourceUrl =
      artifactCase.sourceUrl ?? corpusCases.get(artifactCase.id)?.sourceUrl;
    if (!sourceUrl) {
      throw new Error(`Corpus source URL missing for ${artifactCase.id}`);
    }
    const job: AnalysisCase = {
      ...artifactCase,
      sourceUrl,
    };
    return {
      content: outputFor(artifact, job.id, "content", "gpt-5.6-terra"),
      facts: outputFor(artifact, job.id, "facts", "gpt-5.6-luna"),
      job,
      positions: outputFor(artifact, job.id, "positions", "gpt-5.6-terra"),
      sourceHash: await jobSourceHash(job),
    };
  })
);
const database = new Database(databasePath);
database.exec("PRAGMA foreign_keys = ON");
const timestamp = new Date().toISOString();

const seed = database.transaction(() => {
  database
    .query(
      `UPDATE job_listings
          SET inventory_status='closed',updated_at=?
        WHERE board='fixture' OR title LIKE 'Maestro %'`
    )
    .run(timestamp);

  for (const item of prepared) {
    const facts = JobMatchFactsSchema.parse(item.facts);
    const content = JobContentAnalysisSchema.parse(item.content);
    const positions = JobPositionAnalysisSchema.parse(item.positions);
    const {
      economics: { compensation },
    } = facts;
    const location =
      positions.positions[0]?.locations[0]?.value || item.job.country;
    const opportunityScope =
      positions.scope === "ambiguous" ? "unknown" : positions.scope;
    const messageRoute =
      positions.scope === "multi_position"
        ? "multi_position"
        : "advertised_position";

    database
      .query(
        `INSERT INTO job_listings
          (id,board,title,company,country,location,salary,description,source_url,
           apply_url,employer_id,first_seen_at,updated_at,compensation_display,
           compensation_amount_min,compensation_amount_max,compensation_currency,
           compensation_period,compensation_qualifier,compensation_source,
           compensation_confidence,compensation_notes_json,opportunity_scope,
           market_segments_json,message_route,contact_name,source_reference,
           inventory_status,source_last_seen_at,source_content_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           board=excluded.board,title=excluded.title,company=excluded.company,
           country=excluded.country,location=excluded.location,
           salary=excluded.salary,description=excluded.description,
           source_url=excluded.source_url,apply_url=excluded.apply_url,
           updated_at=excluded.updated_at,
           compensation_display=excluded.compensation_display,
           compensation_amount_min=excluded.compensation_amount_min,
           compensation_amount_max=excluded.compensation_amount_max,
           compensation_currency=excluded.compensation_currency,
           compensation_period=excluded.compensation_period,
           compensation_qualifier=excluded.compensation_qualifier,
           compensation_source=excluded.compensation_source,
           compensation_confidence=excluded.compensation_confidence,
           opportunity_scope=excluded.opportunity_scope,
           market_segments_json=excluded.market_segments_json,
           message_route=excluded.message_route,
           inventory_status='active',
           source_last_seen_at=excluded.source_last_seen_at,
           source_content_hash=excluded.source_content_hash`
      )
      .run(
        item.job.id,
        item.job.board,
        item.job.title,
        item.job.company,
        item.job.country,
        location,
        item.job.salary,
        item.job.description,
        item.job.sourceUrl,
        item.job.sourceUrl,
        "",
        timestamp,
        timestamp,
        compensationLabel(facts),
        compensation.amountMinimum,
        compensation.amountMaximum,
        compensation.currency,
        compensation.period,
        compensation.qualifier,
        compensation.evidence.length > 0 ? "listing-description" : "unknown",
        compensation.evidence.length > 0 ? "exact" : "unknown",
        "[]",
        opportunityScope,
        JSON.stringify(facts.marketSegments.map((fact) => fact.value)),
        messageRoute,
        "",
        item.job.id,
        "active",
        timestamp,
        item.sourceHash
      );

    database
      .query(
        `INSERT INTO job_match_facts
          (job_id,facts_json,schema_version,model_provider,model_id,updated_at,
           source_hash)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET
           facts_json=excluded.facts_json,
           schema_version=excluded.schema_version,
           model_provider=excluded.model_provider,
           model_id=excluded.model_id,
           updated_at=excluded.updated_at,
           source_hash=excluded.source_hash`
      )
      .run(
        item.job.id,
        JSON.stringify(facts),
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        "codex",
        "gpt-5.6-luna",
        timestamp,
        item.sourceHash
      );

    database
      .query(
        `INSERT INTO job_content_analyses
          (job_id,content_json,schema_version,model_provider,model_id,source_hash,
           updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET
           content_json=excluded.content_json,
           schema_version=excluded.schema_version,
           model_provider=excluded.model_provider,
           model_id=excluded.model_id,
           source_hash=excluded.source_hash,
           updated_at=excluded.updated_at`
      )
      .run(
        item.job.id,
        JSON.stringify(content),
        JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
        "codex",
        "gpt-5.6-terra",
        item.sourceHash,
        timestamp
      );

    database
      .query("DELETE FROM job_position_variants WHERE job_id=?")
      .run(item.job.id);
    database
      .query(
        `INSERT INTO job_position_analyses
          (job_id,scope,review_notes_json,schema_version,model_provider,model_id,
           source_hash,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET
           scope=excluded.scope,
           review_notes_json=excluded.review_notes_json,
           schema_version=excluded.schema_version,
           model_provider=excluded.model_provider,
           model_id=excluded.model_id,
           source_hash=excluded.source_hash,
           updated_at=excluded.updated_at`
      )
      .run(
        item.job.id,
        positions.scope,
        JSON.stringify(positions.reviewNotes),
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        "codex",
        "gpt-5.6-terra",
        item.sourceHash,
        timestamp
      );
    positions.positions.forEach((position, ordinal) => {
      database
        .query(
          `INSERT INTO job_position_variants
            (id,job_id,ordinal,title,role_family,subjects_json,locations_json,
             audiences_json,employment_types_json,requirements_json,evidence_json,
             compensation_evidence_json,certainty,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          crypto.randomUUID(),
          item.job.id,
          ordinal,
          position.title,
          position.roleFamily,
          JSON.stringify(position.subjects),
          JSON.stringify(position.locations),
          JSON.stringify(position.audiences),
          JSON.stringify(position.employmentTypes),
          JSON.stringify(position.requirements),
          JSON.stringify(position.evidence),
          JSON.stringify(position.compensationEvidence),
          position.certainty,
          timestamp,
          timestamp
        );
    });

    database
      .query("DELETE FROM application_routes WHERE job_id=?")
      .run(item.job.id);
    database
      .query(
        `INSERT INTO application_routes
          (id,job_id,kind,destination,source_evidence,last_verified_at,status,
           created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        crypto.randomUUID(),
        item.job.id,
        "external_url",
        item.job.sourceUrl,
        item.job.sourceUrl,
        timestamp,
        "active",
        timestamp,
        timestamp
      );
  }
});

try {
  seed();
  const active = database
    .query<{ count: number }, []>(
      "SELECT count(*) count FROM job_listings WHERE inventory_status='active'"
    )
    .get();
  console.log(
    JSON.stringify(
      {
        activeListings: active?.count ?? 0,
        artifact: basename(artifactPath),
        database: databasePath,
        seeded: prepared.length,
      },
      null,
      2
    )
  );
} finally {
  database.close();
}

function outputFor(
  sourceArtifact: BakeoffArtifact,
  caseId: string,
  task: AnalysisTask,
  model: string
) {
  const result = sourceArtifact.results.find(
    (candidate) =>
      candidate.caseId === caseId &&
      candidate.task === task &&
      candidate.model === model &&
      candidate.supportedEvidence &&
      candidate.output
  );
  if (!result?.output) {
    throw new Error(`${model} has no validated ${task} output for ${caseId}`);
  }
  return result.output;
}

function compensationLabel(
  facts: ReturnType<typeof JobMatchFactsSchema.parse>
) {
  const {
    economics: { compensation },
  } = facts;
  if (compensation.kind === "negotiable") {
    return "Pay negotiable";
  }
  if (
    compensation.kind !== "amount" ||
    !compensation.currency ||
    !compensation.period
  ) {
    return "Salary not listed";
  }
  const minimum = compensation.amountMinimum?.toLocaleString("en-US");
  const maximum = compensation.amountMaximum?.toLocaleString("en-US");
  const amount =
    minimum && maximum && minimum !== maximum
      ? `${minimum}–${maximum}`
      : (minimum ?? maximum ?? "");
  return `${compensation.currency} ${amount} per ${compensation.period}`;
}

function latestArtifactPath() {
  const directory = resolve(import.meta.dir, "artifacts");
  const candidates = readdirSync(directory)
    .filter((name) => name.startsWith("bakeoff-") && name.endsWith(".json"))
    .map((name) => resolve(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  const [latest] = candidates;
  if (!latest) {
    throw new Error("Run `bun run jobkit -- experiments analysis` first");
  }
  return latest;
}

function localD1Path() {
  const directory = resolve(
    import.meta.dir,
    "../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  );
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => resolve(directory, name))
    .sort((left, right) => statSync(right).size - statSync(left).size);
  const [candidatePath] = candidates;
  if (!candidatePath) {
    throw new Error("Create the local D1 database before seeding the preview");
  }
  return candidatePath;
}
