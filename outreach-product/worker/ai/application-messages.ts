import { generateText, Output } from "ai";
import { z } from "zod";
import type { Preferences } from "../../src/features/preferences/schema";
import type { Profile } from "../../src/features/profile/schema";
import type { AppEnv } from "../env";
import type { MessageExemplar } from "../repositories/message-exemplars";
import type { ActiveMessageFoundation } from "../repositories/message-foundations";
import type { ApplicationMessageRoute, JobImport } from "../schemas";
import {
  APPLICATION_MESSAGE_INSTRUCTIONS,
  applicationMessagePolicyFor,
  type MessageShape,
  validateApplicationMessage,
} from "./application-message-policy";
import { type AiModelSelection, createAiModel } from "./model-catalog";

const WHITESPACE_PATTERN = /\s+/u;

const DraftOutputSchema = z
  .object({
    message: z.string().min(100).max(5000),
    summary: z.string().min(1).max(500),
  })
  .strict();

// Cerebras structured output rejects JSON Schema string-length keywords. Keep
// the provider schema portable, then enforce the stricter limits after parsing.
const ProviderDraftOutputSchema = z
  .object({
    message: z.string(),
    summary: z.string(),
  })
  .strict();

export interface GeneratedApplicationMessage
  extends z.infer<typeof DraftOutputSchema> {
  modelId: string;
  provider: "cerebras" | "mistral";
}

export class ApplicationMessageGenerationError extends Error {}

export interface MessageContext extends ActiveMessageFoundation {
  exemplars?: MessageExemplar[];
  preferences?: Preferences | null;
  shape?: MessageShape;
}

export function generateApplicationMessage(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport,
  profile: Profile,
  styleGuidance: string[],
  context: MessageContext
): Promise<GeneratedApplicationMessage> {
  const signature = signatureFor(profile);
  const messageRoute = messageRouteFor(job);
  const policy = applicationMessagePolicyFor(
    messageRoute,
    context.approvedTemplate
  );
  return runModel(env, model, {
    approvedTemplate: policy.approvedTemplate,
    candidatePreferences: messagePreferences(context.preferences),
    candidateProfile: messageProfile(profile),
    job,
    messageRoute,
    provenExamples: exemplarPrompts(context.exemplars),
    questionGuidance: policy.questionGuidance,
    request: "Write a new application message.",
    requiredEnding: `Best,\n${signature}`,
    styleGuidance: [...context.voiceRules, ...styleGuidance],
  });
}

export function reviseApplicationMessage(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport,
  profile: Profile,
  currentMessage: string,
  revisionInstruction: string,
  styleGuidance: string[],
  context: MessageContext
): Promise<GeneratedApplicationMessage> {
  const signature = signatureFor(profile);
  const messageRoute = messageRouteFor(job);
  const policy = applicationMessagePolicyFor(
    messageRoute,
    context.approvedTemplate
  );
  return runModel(env, model, {
    approvedTemplate: policy.approvedTemplate,
    candidatePreferences: messagePreferences(context.preferences),
    candidateProfile: messageProfile(profile),
    currentMessage,
    job,
    messageRoute,
    provenExamples: exemplarPrompts(context.exemplars),
    questionGuidance: policy.questionGuidance,
    request:
      "Revise the current message according to revisionInstruction while preserving every rule.",
    requiredEnding: `Best,\n${signature}`,
    revisionInstruction,
    styleGuidance: [...context.voiceRules, ...styleGuidance],
  });
}

async function runModel(
  env: AppEnv,
  selection: AiModelSelection,
  input: Record<string, unknown> & {
    messageRoute: ApplicationMessageRoute;
    requiredEnding: string;
  }
): Promise<GeneratedApplicationMessage> {
  const model = createAiModel(env, selection);
  try {
    let validationFeedback = "";
    for (
      let generationAttempt = 1;
      generationAttempt <= 3;
      generationAttempt += 1
    ) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Validation feedback from each failed generation is fed into the next attempt.
        const result = await generateText({
          instructions: APPLICATION_MESSAGE_INSTRUCTIONS,
          maxOutputTokens: 1200,
          maxRetries: 2,
          model,
          output: Output.object({
            description: "A truthful job application and its tailoring summary",
            name: "job_application_draft",
            schema: ProviderDraftOutputSchema,
          }),
          prompt: JSON.stringify({ ...input, validationFeedback }),
          providerOptions:
            selection.provider === "cerebras" &&
            selection.modelId === "zai-glm-4.7"
              ? { cerebras: { reasoningEffort: "none" } }
              : undefined,
          temperature: 0.1,
          timeout: { totalMs: 45_000 },
        });
        const output = DraftOutputSchema.parse(result.output);
        const message = validateApplicationMessage(
          output.message,
          input.requiredEnding,
          input.messageRoute
        );
        return {
          message,
          modelId: selection.modelId,
          provider: selection.provider,
          summary: output.summary.trim(),
        };
      } catch (error) {
        validationFeedback =
          error instanceof Error
            ? error.message
            : "The output did not pass validation";
        if (generationAttempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Application-message generation exhausted all attempts");
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "draft_generation_failed",
        model: selection.modelId,
        provider: selection.provider,
      })
    );
    throw new ApplicationMessageGenerationError(
      `Application-message generation failed using ${selection.provider}/${selection.modelId}`,
      { cause: error }
    );
  }
}

export function messageRouteFor(job: JobImport): ApplicationMessageRoute {
  return job.opportunityScope === "multi_position"
    ? "multi_position"
    : job.messageRoute;
}

function messageProfile(profile: Profile) {
  return {
    availability: profile.availability,
    citizenship: profile.citizenship,
    credentials: profile.credentials,
    currentLocation: profile.currentLocation,
    education: profile.education,
    experienceLabel: profile.experienceLabel,
    fields: profile.fields,
    introduction: profile.introduction,
    languages: profile.languages,
    workAuthorization: profile.workAuthorization,
    workExperience: profile.workExperience,
  };
}

// Preferences relevant to how the candidate frames interest in a message;
// compensation floors and benefit demands never belong in an application.
function messagePreferences(preferences: Preferences | null | undefined) {
  if (!preferences) {
    return null;
  }
  const wanted = (rules: Record<string, string>) =>
    Object.entries(rules)
      .filter(([, strength]) => strength === "prefer")
      .map(([name]) => name);
  return {
    preferredAudiences: wanted(preferences.audiences),
    preferredCountries: preferences.countries.preferred,
    preferredEmployment: wanted(preferences.employment),
  };
}

function exemplarPrompts(exemplars: MessageExemplar[] | undefined) {
  if (!exemplars || exemplars.length === 0) {
    return [];
  }
  return exemplars.map((exemplar) => ({
    body: exemplar.body,
    context: `Sent ${exemplar.sentAt.slice(0, 7)} to a ${exemplar.country || "school"} contact; outcome: ${exemplar.outcome}`,
  }));
}

function signatureFor(profile: Profile): string {
  const surname =
    profile.fullName.trim().split(WHITESPACE_PATTERN).at(-1) ?? "";
  return `${profile.preferredName} ${surname}`.trim();
}
