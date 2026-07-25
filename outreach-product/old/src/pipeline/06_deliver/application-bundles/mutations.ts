import type { AppEnv } from "../../../../worker/env";
import {
  copyPacketSnapshotStatements,
  copyPacketSnapshotWrites,
} from "../../../../worker/repositories/draft-attachments";
import type {
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../../../../worker/services/agent-tasks/run-store";
import type { Profile } from "../../../features/profile/schema";
import {
  DraftMutationError,
  messageContext,
} from "../../04_compose/application-drafts";
import { validateApplicationMessage } from "../../04_compose/application-message-policy";
import {
  messageRouteFor,
  openingFor,
  signatureFor,
} from "../../04_compose/application-messages";
import {
  ANESL_REQUIRED_QUESTION,
  ApplicationBundleError,
  aneslBundleJob,
  readAneslBundleTargets,
} from "../application-bundle-model";

export interface CurrentBundleDraft {
  bundleId: string;
  draftId: string;
  foundationId: string | null;
  job: ReturnType<typeof aneslBundleJob>;
  message: string;
  requiredOpening: string;
  targetCount: number;
  templateKey: string | null;
  userJobId: string;
  version: number;
}

interface BundleDraftMutation {
  changeSummary: string;
  foundationId: string | null;
  message: string;
  modelId: string | null;
  modelProvider: string | null;
  revisionInstruction: string;
  revisionSource: "ai_revision" | "manual_edit" | "undo";
  snapshotDraftId: string;
  templateKey: string | null;
}

export async function currentBundleDraft(
  db: D1Database,
  userId: string,
  bundleId: string
): Promise<CurrentBundleDraft> {
  const targets = await readAneslBundleTargets(db, userId, bundleId);
  const [first] = targets;
  if (!first) {
    throw new ApplicationBundleError("ANESL application set not found", 404);
  }
  const draft = await db
    .prepare(
      `SELECT id,version,message,required_opening,message_foundation_id,
              message_template_key
       FROM application_drafts
      WHERE application_bundle_id=?
      ORDER BY version DESC LIMIT 1`
    )
    .bind(bundleId)
    .first<{
      id: string;
      message: string;
      required_opening: string;
      message_foundation_id: string | null;
      message_template_key: string | null;
      version: number;
    }>();
  if (!draft) {
    throw new ApplicationBundleError("ANESL application draft not found", 404);
  }
  return {
    bundleId,
    draftId: draft.id,
    foundationId: draft.message_foundation_id,
    job: aneslBundleJob(bundleId, targets),
    message: draft.message,
    requiredOpening: draft.required_opening,
    targetCount: targets.length,
    templateKey: draft.message_template_key,
    userJobId: first.user_job_id,
    version: draft.version,
  };
}

export async function persistBundleDraftMutation(
  env: AppEnv,
  userId: string,
  current: CurrentBundleDraft,
  input: BundleDraftMutation
) {
  const plan = buildBundleDraftMutationPlan(env, userId, current, input);
  await env.DB.batch(plan.statements);
  return plan.result;
}

function buildBundleDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentBundleDraft,
  input: BundleDraftMutation
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  return {
    result: {
      applicationSetId: current.bundleId,
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
    statements: [
      env.DB.prepare(
        `UPDATE outbound_recipient_claims
            SET status='released',released_at=?,updated_at=?
          WHERE source_kind='application_attempt' AND status='claimed'
            AND source_id IN (
              SELECT id FROM application_attempts
               WHERE application_bundle_id=? AND draft_id=?
                 AND status='approved' AND send_requested_at IS NULL
                 AND gmail_draft_id=''
            )`
      ).bind(timestamp, timestamp, current.bundleId, current.draftId),
      env.DB.prepare(
        `DELETE FROM application_attempts
          WHERE application_bundle_id=? AND draft_id=? AND status='approved'
            AND send_requested_at IS NULL AND gmail_draft_id=''`
      ).bind(current.bundleId, current.draftId),
      env.DB.prepare(
        `UPDATE application_drafts SET status='superseded'
          WHERE id=? AND application_bundle_id=? AND status IN ('draft','approved')`
      ).bind(current.draftId, current.bundleId),
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,application_bundle_id,version,message,required_opening,
           change_summary,revision_instruction,model_provider,model_id,
           message_foundation_id,message_template_key,revision_source,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        current.userJobId,
        current.bundleId,
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
        `UPDATE user_listing_states SET status='review',updated_at=?
          WHERE user_id=? AND id IN (
            SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
          ) AND status IN ('new','review','approved','failed')`
      ).bind(timestamp, userId, current.bundleId),
      env.DB.prepare(
        `UPDATE application_bundles SET status='review',updated_at=?
          WHERE id=? AND user_id=? AND status IN ('review','approved','failed')`
      ).bind(timestamp, current.bundleId, userId),
    ],
  };
}

export async function buildFencedBundleDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentBundleDraft,
  input: BundleDraftMutation,
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
               WHERE application_bundle_id=? AND draft_id=?
                 AND status='approved' AND send_requested_at IS NULL
                 AND gmail_draft_id=''
            ) AND ${fence.clause}`
      ).bind(
        timestamp,
        timestamp,
        current.bundleId,
        current.draftId,
        ...fence.values
      ),
    },
    {
      statement: env.DB.prepare(
        `DELETE FROM application_attempts
          WHERE application_bundle_id=? AND draft_id=? AND status='approved'
            AND send_requested_at IS NULL AND gmail_draft_id=''
            AND ${fence.clause}`
      ).bind(current.bundleId, current.draftId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `UPDATE application_drafts SET status='superseded'
          WHERE id=? AND application_bundle_id=?
            AND status IN ('draft','approved') AND ${fence.clause}`
      ).bind(current.draftId, current.bundleId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,application_bundle_id,version,message,required_opening,
           change_summary,revision_instruction,model_provider,model_id,
           message_foundation_id,message_template_key,revision_source,created_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fence.clause}`
      ).bind(
        draftId,
        current.userJobId,
        current.bundleId,
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
      expectedChanges: current.targetCount,
      statement: env.DB.prepare(
        `UPDATE user_listing_states SET status='review',updated_at=?
          WHERE user_id=? AND id IN (
            SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
          ) AND status IN ('new','review','approved','failed')
            AND ${fence.clause}`
      ).bind(timestamp, userId, current.bundleId, ...fence.values),
    },
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `UPDATE application_bundles SET status='review',updated_at=?
          WHERE id=? AND user_id=? AND status IN ('review','approved','failed')
            AND ${fence.clause}`
      ).bind(timestamp, current.bundleId, userId, ...fence.values),
    },
  ];
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM application_drafts completion_draft
        JOIN application_bundles completion_bundle
          ON completion_bundle.id=completion_draft.application_bundle_id
       WHERE completion_draft.id=?
         AND completion_draft.application_bundle_id=?
         AND completion_draft.version=?
         AND completion_draft.status IN ('draft','approved')
         AND completion_bundle.user_id=?
         AND completion_bundle.status IN ('review','approved','failed')
      ) AND NOT EXISTS (
        SELECT 1 FROM application_drafts newer_draft
         WHERE newer_draft.application_bundle_id=? AND newer_draft.version>?
      ) AND (${packetCopy.condition.clause})`,
      values: [
        current.draftId,
        current.bundleId,
        current.version,
        userId,
        current.bundleId,
        current.version,
        ...packetCopy.condition.values,
      ],
    },
    result: {
      applicationSetId: current.bundleId,
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

export async function bundleMessageContext(
  env: AppEnv,
  userId: string,
  job: ReturnType<typeof aneslBundleJob>
) {
  const context = await messageContext(env, userId, job, {
    audience: "general",
    length: "long",
  });
  context.requiredPositionReferences = job.sourceReference
    .split(",")
    .map((reference) => reference.trim())
    .filter(Boolean);
  context.requiredQuestion = ANESL_REQUIRED_QUESTION;
  return context;
}

export function validatedBundleMessage(
  rawMessage: string,
  job: ReturnType<typeof aneslBundleJob>,
  profile: Profile
) {
  try {
    const message = validateApplicationMessage(
      rawMessage,
      openingFor(job.contactName),
      `Best,\n${signatureFor(profile)}`,
      messageRouteFor(job),
      ANESL_REQUIRED_QUESTION
    );
    const missing = job.sourceReference
      .split(",")
      .map((reference) => reference.trim())
      .filter((reference) => reference && !message.includes(reference));
    if (missing.length > 0) {
      throw new Error(
        `The message must include every selected position ID: ${missing.join(", ")}`
      );
    }
    return message;
  } catch (error) {
    throw new DraftMutationError(
      error instanceof Error ? error.message : "The message is invalid",
      { cause: error },
      422
    );
  }
}
