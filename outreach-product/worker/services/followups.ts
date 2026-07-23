import { ApplicationMessageTaskOutputSchema } from "../../src/agent-tasks/application-message";
import { validateApplicationMessage } from "../ai/application-message-policy";
import { messageProfile, signatureFor } from "../ai/application-messages";
import type { AppEnv } from "../env";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { readUserTimeZone } from "../repositories/user-time-zone";
import type { AgentTaskCompletionFence } from "./agent-tasks/run-store";
import { savedProfile } from "./application-drafts";
import {
  FollowUpError,
  type FollowUpTaskInput,
  type FollowUpView,
  type FoundationRow,
  MAX_FOLLOW_UP_WORDS,
  NON_WORD_PATTERN,
} from "./followups/model";
import {
  followUpCandidates,
  queueDueCandidate,
  readFollowUpSource,
} from "./followups/storage";
import { followUpQuestion, openingFrom, voiceRules } from "./followups/text";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  createFollowUpGmailDraft,
  markFollowUpTaskFailed,
  sendFollowUpGmailDraft,
} from "./followups/gmail";
export type { FollowUpTaskInput, FollowUpView } from "./followups/model";
export { FollowUpError } from "./followups/model";

export async function queueDueFollowUps(env: AppEnv) {
  const candidates = await followUpCandidates(env.DB);
  let queued = 0;
  for (const candidate of candidates) {
    // D1 serializes each durable scheduling decision. Processing candidates in
    // order also makes the resulting audit trail stable across cron retries.
    // biome-ignore lint/performance/noAwaitInLoops: Each candidate is a separate transactional scheduling decision.
    const created = await queueDueCandidate(env.DB, candidate, new Date());
    queued += Number(created);
  }
  return { considered: candidates.length, queued };
}

export async function listThreadFollowUps(
  db: D1Database,
  userId: string,
  gmailThreadId: string
): Promise<FollowUpView[]> {
  if (!gmailThreadId) {
    return [];
  }
  const rows = await db
    .prepare(
      `SELECT id,ordinal,due_at,status,message,change_summary,gmail_draft_id
         FROM outreach_followups
        WHERE user_id=? AND gmail_thread_id=?
        ORDER BY ordinal`
    )
    .bind(userId, gmailThreadId)
    .all<{
      change_summary: string;
      due_at: string;
      gmail_draft_id: string;
      id: string;
      message: string;
      ordinal: number;
      status: string;
    }>();
  return rows.results.map((row) => ({
    changeSummary: row.change_summary,
    dueAt: row.due_at,
    gmailDraftId: row.gmail_draft_id,
    id: row.id,
    message: row.message,
    ordinal: row.ordinal,
    status: row.status,
  }));
}

export async function prepareFollowUpTask(
  env: AppEnv,
  userId: string,
  input: FollowUpTaskInput
) {
  const source = await readFollowUpSource(env.DB, userId, input.followUpId);
  if (source.status !== "scheduled" && source.status !== "drafting") {
    throw new FollowUpError("Follow-up is no longer awaiting a draft");
  }
  const [profile, timeZone, styleGuidance, foundation] = await Promise.all([
    savedProfile(env.DB, userId),
    readUserTimeZone(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
    env.DB.prepare(
      `SELECT voice_rules_json FROM user_message_foundations
          WHERE user_id=? AND status='active' LIMIT 1`
    )
      .bind(userId)
      .first<FoundationRow>(),
  ]);
  const requiredOpening = openingFrom(source.message);
  const requiredEnding = `Best,\n${signatureFor(profile)}`;
  const requiredQuestion = followUpQuestion(
    source.route,
    source.created_at,
    timeZone
  );
  return {
    input: {
      approvedTemplate: `${requiredOpening}\n\nI wanted to follow up on my earlier message about [the role or teaching opportunities]. [One short sentence that adds only useful, truthful context.]\n\n${requiredQuestion}\n\n${requiredEnding}`,
      candidateProfile: messageProfile(profile),
      currentMessage: source.message,
      job: {
        company: source.company,
        country: source.country,
        location: source.location,
        title: source.title,
      },
      messageRoute: source.route,
      questionGuidance:
        "Use the exact requiredQuestion. Invite a conversation without asking whether the employer is hiring.",
      request:
        "Write a brief in-thread follow-up to the prior sent message. Do not repeat the full application or add a new subject line.",
      requiredEnding,
      requiredOpening,
      requiredPositionReferences: [],
      requiredQuestion,
      styleGuidance: [
        ...voiceRules(foundation),
        ...styleGuidance,
        "Keep this follow-up under 120 words, including the signature.",
      ],
    },
    source,
  };
}

export async function buildFollowUpTaskCompletion(
  env: AppEnv,
  userId: string,
  input: FollowUpTaskInput,
  rawOutput: unknown,
  modelId: string,
  fence: AgentTaskCompletionFence
) {
  const prepared = await prepareFollowUpTask(env, userId, input);
  const output = ApplicationMessageTaskOutputSchema.parse(rawOutput);
  const message = validateApplicationMessage(
    output.message,
    prepared.input.requiredOpening,
    prepared.input.requiredEnding,
    prepared.source.route,
    prepared.input.requiredQuestion
  );
  const words = message.split(NON_WORD_PATTERN).filter(Boolean).length;
  if (words > MAX_FOLLOW_UP_WORDS) {
    throw new FollowUpError(
      `Follow-up must be at most ${MAX_FOLLOW_UP_WORDS} words; found ${words}`,
      422
    );
  }
  const timestamp = new Date().toISOString();
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM outreach_followups completion_followup
         WHERE completion_followup.id=?
           AND completion_followup.user_id=?
           AND completion_followup.status='drafting'
      )`,
      values: [input.followUpId, userId],
    },
    result: {
      changeSummary: output.summary.trim(),
      followUpId: input.followUpId,
      message,
      modelId,
      provider: "codex" as const,
    },
    writes: [
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `UPDATE outreach_followups
                SET status='review',message=?,change_summary=?,model_id=?,
                    error_detail='',updated_at=?
              WHERE id=? AND user_id=? AND status='drafting'
                AND ${fence.clause}`
        ).bind(
          message,
          output.summary.trim(),
          modelId,
          timestamp,
          input.followUpId,
          userId,
          ...fence.values
        ),
      },
    ],
  };
}
