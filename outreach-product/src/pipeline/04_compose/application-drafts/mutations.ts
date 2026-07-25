import type { AppEnv } from "../../../../worker/env";
import {
  copyPacketSnapshotStatements,
  copyPacketSnapshotWrites,
} from "../../../../worker/repositories/draft-attachments";
import { jobEventStatement } from "../../../../worker/repositories/job-events";
import { readProfile } from "../../../../worker/repositories/user-settings";
import { type JobImport, JobImportSchema } from "../../../../worker/schemas";
import type {
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../../../../worker/services/agent-tasks/run-store";
import type { Profile } from "../../../features/profile/schema";
import { DraftProfileRequiredError } from "../application-drafts";

type DraftRevisionSource = "ai_revision" | "manual_edit" | "undo";

export interface CurrentDraft {
  draftId: string;
  foundationId: string | null;
  job: JobImport;
  message: string;
  requiredOpening: string;
  templateKey: string | null;
  userJobId: string;
  version: number;
}

export interface PreviousDraftRow {
  id: string;
  message: string;
  message_foundation_id: string | null;
  message_template_key: string | null;
  model_id: string | null;
  model_provider: string | null;
  version: number;
}

interface DraftMutationInput {
  changeSummary: string;
  eventType: string;
  foundationId: string | null;
  message: string;
  modelId: string | null;
  modelProvider: string | null;
  revisionInstruction: string;
  revisionSource: DraftRevisionSource;
  snapshotDraftId: string;
  templateKey: string | null;
}

export async function persistDraftMutation(
  env: AppEnv,
  userId: string,
  current: CurrentDraft,
  input: DraftMutationInput
) {
  const plan = buildDraftMutationPlan(env, userId, current, input);
  await env.DB.batch(plan.statements);
  return plan.result;
}

function buildDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentDraft,
  input: DraftMutationInput
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  const statements = [
    env.DB.prepare(
      `UPDATE outbound_recipient_claims
          SET status='released',released_at=?,updated_at=?
        WHERE source_kind='application_attempt' AND status='claimed'
          AND source_id IN (
            SELECT id FROM application_attempts
             WHERE draft_id=? AND status='approved'
               AND send_requested_at IS NULL AND gmail_draft_id=''
          )`
    ).bind(timestamp, timestamp, current.draftId),
    env.DB.prepare(
      `DELETE FROM application_attempts
       WHERE draft_id=? AND status='approved' AND send_requested_at IS NULL
         AND gmail_draft_id=''`
    ).bind(current.draftId),
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE id=? AND status IN ('draft','approved')"
    ).bind(current.draftId),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,required_opening,change_summary,
         revision_instruction,model_provider,model_id,message_foundation_id,
         message_template_key,revision_source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftId,
      current.userJobId,
      version,
      input.message,
      current.requiredOpening,
      input.changeSummary,
      input.revisionInstruction,
      input.modelProvider,
      input.modelId,
      input.foundationId,
      input.templateKey,
      input.revisionSource,
      timestamp
    ),
    ...copyPacketSnapshotStatements(
      env.DB,
      input.snapshotDraftId,
      draftId,
      timestamp
    ),
    env.DB.prepare(
      "UPDATE user_listing_states SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, current.userJobId, userId),
    jobEventStatement(
      env.DB,
      current.userJobId,
      input.eventType,
      input.changeSummary,
      draftId
    ),
  ];
  return {
    result: {
      draft: {
        changeSummary: input.changeSummary,
        createdAt: timestamp,
        id: draftId,
        message: input.message,
        previousMessage: current.message,
        revisionSource: input.revisionSource,
        status: "draft" as const,
        version,
      },
    },
    statements,
  };
}

export async function buildFencedDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentDraft,
  input: DraftMutationInput,
  fence: AgentTaskCompletionFence
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  const packetCopy = await copyPacketSnapshotWrites(
    env.DB,
    input.snapshotDraftId,
    draftId,
    timestamp,
    fence
  );
  const writes: AgentTaskCompletionWrite[] = [
    {
      statement: env.DB.prepare(
        `UPDATE outbound_recipient_claims
            SET status='released',released_at=?,updated_at=?
          WHERE source_kind='application_attempt' AND status='claimed'
            AND source_id IN (
              SELECT id FROM application_attempts
               WHERE draft_id=? AND status='approved'
                 AND send_requested_at IS NULL AND gmail_draft_id=''
            ) AND ${fence.clause}`
      ).bind(timestamp, timestamp, current.draftId, ...fence.values),
    },
    {
      statement: env.DB.prepare(
        `DELETE FROM application_attempts
          WHERE draft_id=? AND status='approved' AND send_requested_at IS NULL
            AND gmail_draft_id='' AND ${fence.clause}`
      ).bind(current.draftId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `UPDATE application_drafts SET status='superseded'
          WHERE id=? AND status IN ('draft','approved') AND ${fence.clause}`
      ).bind(current.draftId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,version,message,required_opening,change_summary,
           revision_instruction,model_provider,model_id,message_foundation_id,
           message_template_key,revision_source,created_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fence.clause}`
      ).bind(
        draftId,
        current.userJobId,
        version,
        input.message,
        current.requiredOpening,
        input.changeSummary,
        input.revisionInstruction,
        input.modelProvider,
        input.modelId,
        input.foundationId,
        input.templateKey,
        input.revisionSource,
        timestamp,
        ...fence.values
      ),
    },
    ...packetCopy.writes,
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `UPDATE user_listing_states SET status='review',updated_at=?
          WHERE id=? AND user_id=? AND ${fence.clause}`
      ).bind(timestamp, current.userJobId, userId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: jobEventStatement(
        env.DB,
        current.userJobId,
        input.eventType,
        input.changeSummary,
        draftId,
        {},
        fence
      ),
    },
  ];
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM application_drafts completion_draft
        JOIN user_listing_states completion_job
          ON completion_job.id=completion_draft.user_job_id
       WHERE completion_draft.id=?
         AND completion_draft.user_job_id=?
         AND completion_draft.version=?
         AND completion_draft.status IN ('draft','approved')
         AND completion_job.user_id=?
      ) AND NOT EXISTS (
        SELECT 1 FROM application_drafts newer_draft
         WHERE newer_draft.user_job_id=? AND newer_draft.version>?
      ) AND (${packetCopy.condition.clause})`,
      values: [
        current.draftId,
        current.userJobId,
        current.version,
        userId,
        current.userJobId,
        current.version,
        ...packetCopy.condition.values,
      ],
    },
    result: {
      draft: {
        changeSummary: input.changeSummary,
        createdAt: timestamp,
        id: draftId,
        message: input.message,
        previousMessage: current.message,
        revisionSource: input.revisionSource,
        status: "draft" as const,
        version,
      },
    },
    writes,
  };
}

export async function currentJobAndDraft(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const row = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.priority,d.id draft_id,d.version,d.message,
              d.required_opening,d.message_foundation_id,d.message_template_key
       FROM user_listing_states uj
       JOIN job_listings j ON j.id=uj.job_id
       JOIN application_drafts d ON d.user_job_id=uj.id
       WHERE uj.user_id=? AND j.id=?
       ORDER BY d.version DESC LIMIT 1`
    )
    .bind(userId, jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job or draft not found");
  }
  return {
    draftId: String(row.draft_id),
    foundationId: row.message_foundation_id
      ? String(row.message_foundation_id)
      : null,
    job: jobImportFromRow(row),
    message: String(row.message),
    requiredOpening: String(row.required_opening),
    templateKey: row.message_template_key
      ? String(row.message_template_key)
      : null,
    userJobId: String(row.user_job_id),
    version: Number(row.version),
  };
}

export async function readJobForDraftGeneration(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const row = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.priority,
              (SELECT MAX(version) FROM application_drafts d
                WHERE d.user_job_id=uj.id) latest_version
         FROM user_listing_states uj
         JOIN job_listings j ON j.id=uj.job_id
        WHERE uj.user_id=? AND j.id=?`
    )
    .bind(userId, jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job not found");
  }
  return row;
}

export async function savedProfile(
  db: D1Database,
  userId: string
): Promise<Profile> {
  const profile = await readProfile(db, userId);
  if (!profile.updatedAt) {
    throw new DraftProfileRequiredError(
      "Save a profile before generating or revising drafts"
    );
  }
  return profile.value;
}

export function jobImportFromRow(row: Record<string, unknown>): JobImport {
  return JobImportSchema.parse({
    applyUrl: row.apply_url,
    board: row.board,
    company: row.company,
    contactName: row.contact_name,
    country: row.country,
    description: row.description,
    employerId: row.employer_id,
    id: row.id,
    location: row.location,
    marketSegments: JSON.parse(String(row.market_segments_json)),
    messageRoute: row.message_route,
    opportunityScope: row.opportunity_scope,
    priority: row.priority,
    salary: row.salary,
    sourceUrl: row.source_url,
    title: row.title,
  });
}
