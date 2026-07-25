import type { AppEnv } from "../../../worker/env";
import { readMessageStyleGuidance } from "../../../worker/repositories/message-style";
import {
  buildAgentTaskRequestCreation,
  readActiveAgentTaskRequest,
} from "../../../worker/services/agent-task-requests";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../agent-tasks/application-message";
import { ANESL_REQUIRED_QUESTION } from "../06_deliver/application-bundle-model";
import { messageContext, savedProfile } from "./application-drafts";
import {
  type PreparedApplicationMessage,
  prepareApplicationMessageGeneration,
  prepareApplicationMessageRevision,
} from "./application-messages";
import {
  campaignDispatchJob,
  campaignDispatchRecipient,
  campaignDispatchReferences,
  readAcceptedCampaignGuidance,
  readCampaignDispatchTargetCount,
  readCurrentCampaignMessage,
  readDispatch,
} from "./campaign-messages/context";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { buildCampaignDispatchTaskCompletion } from "./campaign-messages/completion";

export interface CampaignDispatchRow {
  campaign_id: string;
  campaign_status: string;
  channel: string;
  country_code: string;
  dedup_key: string;
  id: string;
  job_id: string | null;
  organization_id: string | null;
  route_strategy: "anesl_bundle" | "single";
  run_id: string | null;
  status: string;
  user_id: string;
}

export interface CurrentCampaignMessage {
  id: string;
  message: string;
  version: number;
}

export type CampaignDispatchTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "campaign_dispatch" }
>;

export async function queueCampaignDispatchRevision(
  db: D1Database,
  userId: string,
  campaignId: string,
  dispatchId: string,
  instruction: string
) {
  const dispatch = await readDispatch(db, userId, dispatchId);
  if (dispatch.campaign_id !== campaignId) {
    throw new Error("Campaign dispatch was not found");
  }
  const current = await readCurrentCampaignMessage(db, dispatchId);
  if (!current) {
    throw new Error(
      "Wait for Codex to prepare this message before revising it"
    );
  }
  const active = await readActiveAgentTaskRequest(db, {
    subjectId: dispatchId,
    subjectType: "campaign_dispatch",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  const timestamp = new Date().toISOString();
  if (active) {
    await db
      .prepare(
        `UPDATE campaign_dispatches SET status='drafting',updated_at=?
          WHERE id=? AND campaign_id=? AND status IN ('review','calibration')`
      )
      .bind(timestamp, dispatchId, campaignId)
      .run();
    return active;
  }
  const taskCreation = buildAgentTaskRequestCreation(db, {
    payload: {
      dispatchId,
      expectedMessageId: current.id,
      instruction,
      kind: "campaign_dispatch",
      mode: "revise",
    } satisfies CampaignDispatchTaskInput,
    subjectId: dispatchId,
    subjectType: "campaign_dispatch",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  await db.batch([
    taskCreation.statement,
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='drafting',updated_at=?
          WHERE id=? AND campaign_id=? AND status IN ('review','calibration')`
      )
      .bind(timestamp, dispatchId, campaignId),
  ]);
  return taskCreation.request;
}

export async function approveCampaignDispatch(
  db: D1Database,
  userId: string,
  campaignId: string,
  dispatchId: string
) {
  const dispatch = await readDispatch(db, userId, dispatchId);
  if (dispatch.campaign_id !== campaignId) {
    throw new Error("Campaign dispatch was not found");
  }
  const current = await readCurrentCampaignMessage(db, dispatchId);
  if (!current) {
    throw new Error("The campaign message has not been prepared");
  }
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE campaign_messages SET status='approved',approved_at=?
          WHERE id=? AND dispatch_id=? AND status='draft'`
      )
      .bind(timestamp, current.id, dispatchId),
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='ready',updated_at=?
          WHERE id=? AND campaign_id=? AND status='review'`
      )
      .bind(timestamp, dispatchId, campaignId),
    db
      .prepare(
        `UPDATE campaign_targets SET status='approved',updated_at=?
          WHERE id IN (
            SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
          ) AND status='drafted'`
      )
      .bind(timestamp, dispatchId),
  ]);
  if (results.slice(0, 2).some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("The campaign message changed before it could be approved");
  }
  const remaining = await db
    .prepare(
      `SELECT COUNT(*) count FROM campaign_dispatches
        WHERE campaign_id=? AND status IN ('calibration','drafting','review')`
    )
    .bind(campaignId)
    .first<number>("count");
  if (Number(remaining ?? 0) === 0) {
    await db
      .prepare(
        `UPDATE campaigns
            SET status='ready',first_five_completed_at=?,updated_at=?
          WHERE id=? AND user_id=? AND status='calibrating'`
      )
      .bind(timestamp, timestamp, campaignId, userId)
      .run();
  }
}

export async function prepareCampaignDispatchTask(
  env: AppEnv,
  userId: string,
  input: CampaignDispatchTaskInput
) {
  const dispatch = await readDispatch(env.DB, userId, input.dispatchId);
  const [profile, job, styleGuidance, acceptedGuidance, current, targetCount] =
    await Promise.all([
      savedProfile(env.DB, userId),
      campaignDispatchJob(env.DB, dispatch),
      readMessageStyleGuidance(env.DB, userId),
      readAcceptedCampaignGuidance(env.DB, dispatch.campaign_id),
      readCurrentCampaignMessage(env.DB, input.dispatchId),
      readCampaignDispatchTargetCount(env.DB, input.dispatchId),
    ]);
  const context = await messageContext(
    env,
    userId,
    job,
    dispatch.organization_id || dispatch.route_strategy === "anesl_bundle"
      ? { audience: "general", length: "long" }
      : undefined
  );
  if (dispatch.route_strategy === "anesl_bundle") {
    context.requiredPositionReferences = await campaignDispatchReferences(
      env.DB,
      dispatch.id
    );
    context.requiredQuestion = ANESL_REQUIRED_QUESTION;
  }
  const allGuidance = [...styleGuidance, ...acceptedGuidance];
  let prepared: PreparedApplicationMessage;
  if (input.mode === "revise") {
    if (!(current && current.id === input.expectedMessageId)) {
      throw new Error(
        "The campaign message changed before Codex could revise it"
      );
    }
    prepared = prepareApplicationMessageRevision(
      job,
      profile,
      current.message,
      input.instruction ?? "",
      allGuidance,
      context
    );
    prepared.input.feedbackClassification = {
      decisionOwner: "application-message-agent",
      required: true,
      scopes: {
        campaign:
          "The generalized rule should affect the remaining messages in this campaign.",
        future:
          "The generalized rule is a durable voice, profile, or application rule for this and later campaigns.",
        message:
          "The feedback depends on this recipient, organization, listing, or message only.",
      },
    };
  } else {
    if (current) {
      throw new Error("This campaign dispatch already has a message");
    }
    prepared = prepareApplicationMessageGeneration(
      job,
      profile,
      allGuidance,
      context
    );
  }
  return {
    current,
    dispatch,
    job,
    prepared,
    recipient: await campaignDispatchRecipient(env.DB, dispatch),
    targetCount,
  };
}
