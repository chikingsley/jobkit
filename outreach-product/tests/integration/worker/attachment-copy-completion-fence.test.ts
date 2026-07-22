import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { advertisedPositionQuestion } from "../../../worker/ai/application-message-policy";
import type { AgentRunnerContext } from "../../../worker/app-types";
import type { AppEnv } from "../../../worker/env";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import {
  claimApplicationMessageTask,
  completeApplicationMessageTask,
} from "../../../worker/services/agent-tasks/application-message-adapter";
import { readOwnedRunningAgentTask } from "../../../worker/services/agent-tasks/run-store";
import {
  createAneslApplicationSet,
  reviseAneslApplicationSet,
} from "../../../worker/services/application-bundles";
import {
  queueJobDraftGeneration,
  queueJobDraftRevision,
} from "../../../worker/services/application-drafts";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface RevisionFixture {
  complete: (completionEnv: AppEnv) => Promise<unknown>;
  requestId: string;
  runId: string;
  sourceDraftId: string;
}

const ATTACHMENT_COPY_STATEMENT_INDEX = 10;
const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe.each([
  { create: createJobRevisionFixture, family: "job revision" },
  { create: createAneslRevisionFixture, family: "ANESL revision" },
])("$family packet snapshot completion", ({ create }) => {
  it.each([
    { copiedAttachments: 0, fault: "zero-copy" },
    { copiedAttachments: 1, fault: "partial-copy" },
  ])(
    "rolls back a $fault attachment snapshot",
    async ({ copiedAttachments, fault }) => {
      const fixture = await create(fault);
      const db = interceptBatch(testEnv.DB, (statements, target) => {
        const modified = [...statements];
        modified[ATTACHMENT_COPY_STATEMENT_INDEX] = partialAttachmentCopy(
          target,
          fixture.sourceDraftId,
          copiedAttachments
        );
        return target.batch(modified);
      });

      await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject(
        { status: 409 }
      );

      await expect(readRollbackState(fixture)).resolves.toEqual({
        attachmentCount: 3,
        draftCount: 1,
        guardPresent: false,
        requestStatus: "claimed",
        runStatus: "running",
        sourceDraftStatus: "draft",
      });
    }
  );

  it("keeps an incomplete source packet out of the revision", async () => {
    const fixture = await create("incomplete-source");
    await testEnv.DB.prepare(
      `DELETE FROM application_draft_attachments
        WHERE draft_id=? AND category='tefl'`
    )
      .bind(fixture.sourceDraftId)
      .run();

    await expect(fixture.complete(testEnv)).rejects.toThrow(
      "valid document packet snapshot"
    );

    await expect(readRollbackState(fixture)).resolves.toEqual({
      attachmentCount: 2,
      draftCount: 1,
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
      sourceDraftStatus: "draft",
    });
  });

  it("rolls back when the source packet becomes stale before the batch", async () => {
    const fixture = await create("stale-source");
    const db = interceptBatch(testEnv.DB, async (statements, target) => {
      await target
        .prepare(
          `DELETE FROM application_draft_attachments
            WHERE draft_id=? AND category='tefl'`
        )
        .bind(fixture.sourceDraftId)
        .run();
      return target.batch(statements);
    });

    await expect(fixture.complete(envWithDatabase(db))).rejects.toMatchObject({
      status: 409,
    });

    await expect(readRollbackState(fixture)).resolves.toEqual({
      attachmentCount: 2,
      draftCount: 1,
      guardPresent: false,
      requestStatus: "claimed",
      runStatus: "running",
      sourceDraftStatus: "draft",
    });
  });
});

async function createJobRevisionFixture(
  suffix: string
): Promise<RevisionFixture> {
  const context = await createBaseContext(`job-${suffix}`);
  const jobId = `attachment-copy-job-${suffix}`;
  const timestamp = new Date().toISOString();
  const job = JobImportSchema.parse({
    applyEmail: "hiring@example.test",
    applyUrl: "",
    board: "fixture",
    company: "Example University",
    country: "China",
    description:
      "Example University is seeking an English instructor for adult learners.",
    id: jobId,
    location: "Jinan, China",
    messageRoute: "advertised_position",
    opportunityScope: "direct",
    title: "English instructor",
  });
  await upsertJob(testEnv.DB, job, timestamp);
  await upsertUserJob(testEnv.DB, context.userId, jobId, 1, timestamp);
  await queueJobDraftGeneration(testEnv, context.userId, jobId);
  const generation = await requireApplicationTask(context.runner);
  const question = advertisedPositionQuestion(new Date(), "UTC");
  await completeApplicationMessageTask(
    testEnv,
    context.runner,
    generation.run,
    generation.runId,
    {
      message: jobMessage(context.email, question, "adult English teaching"),
      summary: "Focused the message on adult English teaching.",
    }
  );
  const sourceDraftId = await requireLatestDraftId(context.userId, jobId);
  await requireThreeAttachments(sourceDraftId);
  const request = await queueJobDraftRevision(
    testEnv,
    context.userId,
    jobId,
    "Mention the university classroom context."
  );
  const revision = await requireApplicationTask(context.runner);
  return {
    complete: (completionEnv) =>
      completeApplicationMessageTask(
        completionEnv,
        context.runner,
        revision.run,
        revision.runId,
        {
          message: jobMessage(
            context.email,
            question,
            "adult English teaching in university classrooms"
          ),
          summary: "Added the university classroom context.",
        }
      ),
    requestId: request.id,
    runId: revision.runId,
    sourceDraftId,
  };
}

async function createAneslRevisionFixture(
  suffix: string
): Promise<RevisionFixture> {
  const context = await createBaseContext(`anesl-${suffix}`);
  const timestamp = new Date().toISOString();
  const firstJobId = await seedAneslPosition(`BJ-${suffix}`, timestamp);
  const secondJobId = await seedAneslPosition(`SH-${suffix}`, timestamp);
  const created = await createAneslApplicationSet(testEnv, context.userId, [
    firstJobId,
    secondJobId,
  ]);
  const bundleId = created.applicationSet.id;
  const generation = await requireApplicationTask(context.runner);
  await completeApplicationMessageTask(
    testEnv,
    context.runner,
    generation.run,
    generation.runId,
    {
      message: aneslMessage(context.email, `BJ-${suffix}`, `SH-${suffix}`),
      summary: "Referenced both selected ANESL positions.",
    }
  );
  const sourceDraftId = await requireLatestBundleDraftId(bundleId);
  await requireThreeAttachments(sourceDraftId);
  const revisionRequest = await reviseAneslApplicationSet(
    testEnv,
    context.userId,
    bundleId,
    "Ask which location is the strongest current match."
  );
  const revision = await requireApplicationTask(context.runner);
  return {
    complete: (completionEnv) =>
      completeApplicationMessageTask(
        completionEnv,
        context.runner,
        revision.run,
        revision.runId,
        {
          message: aneslMessage(context.email, `BJ-${suffix}`, `SH-${suffix}`),
          summary: "Added the requested location emphasis.",
        }
      ),
    requestId: revisionRequest.taskRequest.id,
    runId: revision.runId,
    sourceDraftId,
  };
}

async function createBaseContext(suffix: string) {
  const email = `packet-copy-${suffix}@example.test`;
  const { cookie, userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email);
  const timestamp = new Date().toISOString();
  await writeProfile(testEnv.DB, userId, {
    availability: "",
    citizenship: "United States",
    credentials: [],
    currentLocation: "Phoenix, Arizona",
    education: [],
    email,
    experienceLabel: "",
    fields: [],
    fullName: "Integration User",
    introduction: "I teach English to adult and teenage learners.",
    languages: [],
    phone: "",
    preferredName: "Integration",
    profileReviewNotes: [],
    subjectQualifications: [],
    workAuthorization: [],
    workExperience: [],
  });
  await seedMessageFoundation(userId, timestamp);
  await uploadDocument(cookie, "resume", `${suffix}-resume.pdf`);
  await uploadDocument(cookie, "degree", `${suffix}-degree.pdf`);
  await uploadDocument(cookie, "tefl", `${suffix}-tefl.pdf`);
  return { email, runner, userId };
}

async function requireApplicationTask(runner: AgentRunnerContext) {
  const task = await claimApplicationMessageTask(testEnv, runner);
  if (!task) {
    throw new Error("Application message fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  return { run, runId: task.runId };
}

async function createRunner(suffix: string, userId: string, email: string) {
  const timestamp = new Date().toISOString();
  const runner: AgentRunnerContext = {
    capabilities: ["drafting"],
    codexVersion: "codex-cli test",
    id: `attachment-copy-${suffix}-${crypto.randomUUID()}`,
    name: "Attachment copy agent",
    user: {
      email,
      id: userId,
      name: "Integration User",
      role: "operator",
    },
  };
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners
      (id,user_id,name,token_hash,capabilities_json,codex_version,last_seen_at,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      runner.id,
      userId,
      runner.name,
      `${runner.id}-token`,
      JSON.stringify(runner.capabilities),
      runner.codexVersion,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  return runner;
}

async function seedMessageFoundation(userId: string, timestamp: string) {
  const template = "Hello,\n\n[profile-backed application message]";
  await testEnv.DB.prepare(
    `INSERT INTO user_message_foundations
      (id,user_id,version,name,status,voice_rules_json,templates_json,
       created_at,activated_at)
     VALUES (?,?,1,'Test foundation','active',?,?,?,?)`
  )
    .bind(
      `foundation:${userId}`,
      userId,
      JSON.stringify(["Use plain American English."]),
      JSON.stringify({
        advertised_long_general: template,
        advertised_long_young: template,
        advertised_short: template,
        multi_position: template,
        school_outreach_long: template,
        school_outreach_short: template,
      }),
      timestamp,
      timestamp
    )
    .run();
}

async function uploadDocument(
  cookie: string,
  category: string,
  filename: string
) {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
  const response = await exports.default.fetch(
    "https://outreach.test/api/documents",
    {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "application/pdf",
        cookie,
        "x-jobkit-category": category,
        "x-jobkit-filename": filename,
      },
      method: "PUT",
    }
  );
  if (!response.ok) {
    throw new Error(`Fixture document upload failed (${response.status})`);
  }
}

async function seedAneslPosition(reference: string, timestamp: string) {
  const contactId = "contact:attachment-copy";
  const channelId = "contact-channel:attachment-copy";
  const jobId = `anesl:${reference}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO contacts
        (id,display_name,organization_name,role,status,created_at,updated_at)
       VALUES (?,'Mr. Corey Yang','ANESL','board_intermediary','active',?,?)`
    ).bind(contactId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO contact_channels
        (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
       VALUES (?,?,'email','hr@anesl.com','hr@anesl.com','active',?,?)`
    ).bind(channelId, contactId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,description,source_url,
         apply_url,contact_name,source_reference,market_segments_json,
         message_route,opportunity_scope,first_seen_at,updated_at)
       VALUES (?,'anesl',?,'ANESL','China','China',?,?,?,
               'Mr. Corey Yang',?,'["school"]','multi_position',
               'multi_position',?,?)`
    ).bind(
      jobId,
      `English teacher ${reference}`,
      `ANESL position ${reference}`,
      `https://example.test/${reference}`,
      `https://example.test/${reference}`,
      reference,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,contact_channel_id,source_evidence,
         last_verified_at,status,created_at,updated_at)
       VALUES (?,?,'email','hr@anesl.com',?, ?,?,'active',?,?)`
    ).bind(
      `route:${reference}`,
      jobId,
      channelId,
      `ANESL listing ${reference}`,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return jobId;
}

function jobMessage(email: string, question: string, context: string) {
  return `Hello,\n\nI have experience with ${context} and would be glad to discuss this position.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`;
}

function aneslMessage(
  email: string,
  firstReference: string,
  secondReference: string
) {
  return `Hello Mr. Yang,\n\nI am interested in positions ${firstReference} and ${secondReference} and would be glad to discuss the relevant teaching needs.\n\nWould you be open to talking about which of these positions and locations you are currently recruiting for?\n\nBest,\nIntegration User\nE: ${email}`;
}

function partialAttachmentCopy(
  db: D1Database,
  sourceDraftId: string,
  copiedAttachments: number
) {
  return db
    .prepare(
      `INSERT INTO application_draft_attachments
        (draft_id,position,source_document_id,category,filename,object_key,
         content_type,size_bytes,r2_version,etag,created_at)
       SELECT target.id,attachment.position,attachment.source_document_id,
              attachment.category,attachment.filename,attachment.object_key,
              attachment.content_type,attachment.size_bytes,
              attachment.r2_version,attachment.etag,?
         FROM application_draft_attachments attachment
         JOIN application_drafts source ON source.id=attachment.draft_id
         JOIN application_drafts target
           ON target.user_job_id=source.user_job_id
          AND target.version=source.version+1
          AND COALESCE(target.application_bundle_id,'')=
              COALESCE(source.application_bundle_id,'')
        WHERE source.id=?
        ORDER BY attachment.position
        LIMIT ${copiedAttachments}`
    )
    .bind(new Date().toISOString(), sourceDraftId);
}

async function requireLatestDraftId(userId: string, jobId: string) {
  const draft = await testEnv.DB.prepare(
    `SELECT draft.id
       FROM application_drafts draft
       JOIN user_listing_states state ON state.id=draft.user_job_id
      WHERE state.user_id=? AND state.job_id=?
      ORDER BY draft.version DESC LIMIT 1`
  )
    .bind(userId, jobId)
    .first<{ id: string }>();
  if (!draft) {
    throw new Error("Generated job draft was not found");
  }
  return draft.id;
}

async function requireLatestBundleDraftId(bundleId: string) {
  const draft = await testEnv.DB.prepare(
    `SELECT id FROM application_drafts
      WHERE application_bundle_id=? ORDER BY version DESC LIMIT 1`
  )
    .bind(bundleId)
    .first<{ id: string }>();
  if (!draft) {
    throw new Error("Generated ANESL draft was not found");
  }
  return draft.id;
}

async function requireThreeAttachments(draftId: string) {
  const count = await testEnv.DB.prepare(
    "SELECT COUNT(*) count FROM application_draft_attachments WHERE draft_id=?"
  )
    .bind(draftId)
    .first<{ count: number }>();
  if (count?.count !== 3) {
    throw new Error(`Expected three source attachments; found ${count?.count}`);
  }
}

async function readRollbackState(fixture: RevisionFixture) {
  const [draft, draftCount, attachmentCount, request, run] = await Promise.all([
    testEnv.DB.prepare("SELECT status FROM application_drafts WHERE id=?")
      .bind(fixture.sourceDraftId)
      .first<{ status: string }>(),
    testEnv.DB.prepare(
      `SELECT COUNT(*) count FROM application_drafts
        WHERE user_job_id=(
          SELECT user_job_id FROM application_drafts WHERE id=?
        ) AND COALESCE(application_bundle_id,'')=COALESCE((
          SELECT application_bundle_id FROM application_drafts WHERE id=?
        ),'')`
    )
      .bind(fixture.sourceDraftId, fixture.sourceDraftId)
      .first<{ count: number }>(),
    testEnv.DB.prepare(
      "SELECT COUNT(*) count FROM application_draft_attachments WHERE draft_id=?"
    )
      .bind(fixture.sourceDraftId)
      .first<{ count: number }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_requests WHERE id=?"
    )
      .bind(fixture.requestId)
      .first<{ result_json: string | null; status: string }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_runs WHERE id=?"
    )
      .bind(fixture.runId)
      .first<{ result_json: string | null; status: string }>(),
  ]);
  return {
    attachmentCount: attachmentCount?.count ?? -1,
    draftCount: draftCount?.count ?? -1,
    guardPresent: [request?.result_json, run?.result_json].some((resultJson) =>
      Boolean(
        resultJson &&
          Object.hasOwn(JSON.parse(resultJson) as object, "completionGuard")
      )
    ),
    requestStatus: request?.status ?? "missing",
    runStatus: run?.status ?? "missing",
    sourceDraftStatus: draft?.status ?? "missing",
  };
}

function interceptBatch(
  database: D1Database,
  interceptor: (
    statements: D1PreparedStatement[],
    target: D1Database
  ) => Promise<D1Result[]>
) {
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          interceptor(statements, target);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function envWithDatabase(db: D1Database): AppEnv {
  return new Proxy(testEnv, {
    get(target, property) {
      if (property === "DB") {
        return db;
      }
      return Reflect.get(target, property, target);
    },
  });
}
