import { validateGeneratedApplicationMessage } from "../../ai/application-messages";
import type { AppEnv } from "../../env";
import type {
  AgentTaskCompletionCondition,
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../agent-tasks/run-store";
import {
  type CampaignDispatchTaskInput,
  prepareCampaignDispatchTask,
} from "../campaign-messages";
import {
  applicationSubject,
  futureGuidanceWrites,
  requireCampaignRevisionGuidance,
} from "./context";

export async function buildCampaignDispatchTaskCompletion(
  env: AppEnv,
  userId: string,
  input: CampaignDispatchTaskInput,
  rawOutput: unknown,
  modelId: string,
  fence: AgentTaskCompletionFence
) {
  const state = await prepareCampaignDispatchTask(env, userId, input);
  const generated = validateGeneratedApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = (state.current?.version ?? 0) + 1;
  const revisionSource = state.current ? "ai_revision" : "generated";
  const subject = applicationSubject(state.job);
  const automated =
    state.dispatch.campaign_status === "running" &&
    input.mode === "generate" &&
    !state.current;
  const guidance =
    input.mode === "revise"
      ? requireCampaignRevisionGuidance(generated.guidance)
      : null;
  const futureGuidance =
    guidance?.scope === "future"
      ? await futureGuidanceWrites(env.DB, userId, guidance.instruction, fence)
      : { condition: null, writes: [] };
  const guidanceWrites: AgentTaskCompletionWrite[] = guidance
    ? [
        {
          expectedChanges: 1,
          statement: env.DB.prepare(
            `INSERT INTO campaign_guidance
              (id,campaign_id,source_dispatch_id,instruction,scope,status,
               created_at,decided_at)
             SELECT ?,?,?,?,?,'accepted',?,? WHERE ${fence.clause}`
          ).bind(
            crypto.randomUUID(),
            state.dispatch.campaign_id,
            input.dispatchId,
            guidance.instruction,
            guidance.scope,
            timestamp,
            timestamp,
            ...fence.values
          ),
        },
        ...futureGuidance.writes,
      ]
    : [];
  const currentMessageCondition: AgentTaskCompletionCondition = state.current
    ? {
        clause: `EXISTS (
          SELECT 1 FROM campaign_messages completion_message
           WHERE completion_message.id=?
             AND completion_message.dispatch_id=?
             AND completion_message.version=?
             AND completion_message.status='draft'
        ) AND NOT EXISTS (
          SELECT 1 FROM campaign_messages newer_message
           WHERE newer_message.dispatch_id=? AND newer_message.version>?
        )`,
        values: [
          state.current.id,
          input.dispatchId,
          state.current.version,
          input.dispatchId,
          state.current.version,
        ],
      }
    : {
        clause:
          "NOT EXISTS (SELECT 1 FROM campaign_messages WHERE dispatch_id=?)",
        values: [input.dispatchId],
      };
  const conditions: AgentTaskCompletionCondition[] = [
    {
      clause: `EXISTS (
        SELECT 1 FROM campaign_dispatches completion_dispatch
        JOIN campaigns completion_campaign
          ON completion_campaign.id=completion_dispatch.campaign_id
       WHERE completion_dispatch.id=?
         AND completion_dispatch.campaign_id=?
         AND completion_dispatch.status=?
         AND completion_campaign.user_id=?
         AND completion_campaign.status=?
      ) AND (
        SELECT COUNT(*) FROM campaign_dispatch_targets completion_links
        JOIN campaign_targets completion_target
          ON completion_target.id=completion_links.target_id
       WHERE completion_links.dispatch_id=?
         AND completion_target.status IN ('calibration','claimed','drafted')
      )=?`,
      values: [
        input.dispatchId,
        state.dispatch.campaign_id,
        state.dispatch.status,
        userId,
        state.dispatch.campaign_status,
        input.dispatchId,
        state.targetCount,
      ],
    },
    currentMessageCondition,
  ];
  if (futureGuidance.condition) {
    conditions.push(futureGuidance.condition);
  }
  return {
    condition: {
      clause: conditions.map(({ clause }) => `(${clause})`).join(" AND "),
      values: conditions.flatMap(({ values }) => values),
    },
    result: {
      dispatchId: input.dispatchId,
      message: {
        changeSummary: generated.summary,
        createdAt: timestamp,
        id,
        message: generated.message,
        status: "draft" as const,
        version,
      },
    },
    writes: [
      ...guidanceWrites,
      {
        ...(state.current ? { expectedChanges: 1 } : {}),
        statement: env.DB.prepare(
          `UPDATE campaign_messages SET status='superseded'
            WHERE dispatch_id=? AND status='draft' AND ${fence.clause}`
        ).bind(input.dispatchId, ...fence.values),
      },
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `INSERT INTO campaign_messages
            (id,dispatch_id,version,message,change_summary,
             revision_instruction,revision_source,status,model_id,created_at,
             approved_at)
           SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${fence.clause}`
        ).bind(
          id,
          input.dispatchId,
          version,
          generated.message,
          generated.summary,
          input.instruction ?? "",
          revisionSource,
          automated ? "approved" : "draft",
          generated.modelId,
          timestamp,
          automated ? timestamp : null,
          ...fence.values
        ),
      },
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `UPDATE campaign_dispatches
              SET recipient=?,subject=?,status=?,updated_at=?
            WHERE id=? AND campaign_id=? AND status=?
              AND ${fence.clause}`
        ).bind(
          state.recipient,
          subject,
          automated ? "ready" : "review",
          timestamp,
          input.dispatchId,
          state.dispatch.campaign_id,
          state.dispatch.status,
          ...fence.values
        ),
      },
      {
        expectedChanges: state.targetCount,
        statement: env.DB.prepare(
          `UPDATE campaign_targets SET status=?,updated_at=?
            WHERE id IN (
              SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
            ) AND status IN ('calibration','claimed','drafted')
              AND ${fence.clause}`
        ).bind(
          automated ? "approved" : "drafted",
          timestamp,
          input.dispatchId,
          ...fence.values
        ),
      },
      {
        statement: env.DB.prepare(
          `UPDATE campaign_runs SET status='delivering',updated_at=?
            WHERE id=? AND status='generating'
              AND NOT EXISTS (
                SELECT 1 FROM campaign_dispatches pending
                 WHERE pending.run_id=campaign_runs.id
                   AND pending.id<>?
                   AND pending.status IN ('queued','drafting')
              ) AND ${fence.clause}`
        ).bind(
          timestamp,
          state.dispatch.run_id ?? "",
          input.dispatchId,
          ...fence.values
        ),
      },
    ],
  };
}
