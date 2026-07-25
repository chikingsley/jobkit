import type { AppEnv } from "../../../worker/env";
import { readMessageStyleGuidance } from "../../../worker/repositories/message-style";
import { type JobImport, JobImportSchema } from "../../../worker/schemas";
import {
  createAgentTaskRequest,
  readActiveAgentTaskRequest,
} from "../../../worker/services/agent-task-requests";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../agent-tasks/application-message";
import { messageContext, savedProfile } from "./application-drafts";
import { applicationMessagePolicyFor } from "./application-message-policy";
import {
  openingFor,
  prepareApplicationMessageRevision,
  signatureFor,
  validateGeneratedApplicationMessage,
} from "./application-messages";

export type MessagePreviewTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "message_preview" }
>;

const PREVIEW_SAMPLES = [
  {
    description:
      "A named university contact with an intentionally stiff starting message.",
    job: {
      applyUrl: "https://preview.invalid/university",
      board: "preview",
      company: "Haidian University Program",
      contactName: "Mr. Corey Yang",
      country: "China",
      description:
        "The university is seeking an experienced English lecturer for undergraduate speaking and writing classes.",
      id: "preview:university",
      location: "Beijing",
      marketSegments: ["university"],
      messageRoute: "advertised_position",
      opportunityScope: "direct",
      title: "University English Lecturer",
    },
    key: "university",
    label: "Named university contact",
    shape: { audience: "general", length: "long" },
  },
  {
    description:
      "A young-learner role that should use the strongest relevant classroom experience.",
    job: {
      applyUrl: "https://preview.invalid/young-learners",
      board: "preview",
      company: "Maple Tree Academy",
      contactName: "",
      country: "Japan",
      description:
        "The school needs an English teacher for preschool and primary learners, with speaking-focused lessons and parent communication.",
      id: "preview:young-learners",
      location: "Sapporo",
      marketSegments: ["kindergarten", "private_school"],
      messageRoute: "advertised_position",
      opportunityScope: "direct",
      title: "Young Learner English Teacher",
    },
    key: "young-learners",
    label: "Young learner position",
    shape: { audience: "young", length: "long" },
  },
  {
    description:
      "General school outreach with a deliberately over-direct hiring question.",
    job: {
      applyUrl: "https://preview.invalid/school-outreach",
      board: "preview",
      company: "Lighthouse Language School",
      contactName: "",
      country: "Georgia",
      description:
        "An established language school serving adult and teenage English learners.",
      id: "preview:school-outreach",
      location: "Tbilisi",
      marketSegments: ["language_center"],
      messageRoute: "school_outreach",
      opportunityScope: "unknown",
      title: "English Teaching Opportunities",
    },
    key: "school-outreach",
    label: "General school outreach",
    shape: { audience: "general", length: "long" },
  },
] as const;

export async function readMessagePreviews(env: AppEnv, userId: string) {
  const profile = await savedProfile(env.DB, userId);
  return Promise.all(
    PREVIEW_SAMPLES.map(async (sample) => {
      const job = JobImportSchema.parse(sample.job);
      const context = await messageContext(env, userId, job, sample.shape);
      return {
        description: sample.description,
        key: sample.key,
        label: sample.label,
        message: startingMessage(job, profile, context),
      };
    })
  );
}

export async function queueMessagePreviewRevision(
  env: AppEnv,
  userId: string,
  input: MessagePreviewTaskInput
) {
  requirePreviewSample(input.previewKey);
  const active = await readActiveAgentTaskRequest(env.DB, {
    subjectId: input.previewKey,
    subjectType: "message_preview",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  if (active) {
    return active;
  }
  return createAgentTaskRequest(env.DB, {
    payload: input,
    subjectId: input.previewKey,
    subjectType: "message_preview",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
}

export async function prepareMessagePreviewTask(
  env: AppEnv,
  userId: string,
  input: MessagePreviewTaskInput
) {
  const sample = requirePreviewSample(input.previewKey);
  const job = JobImportSchema.parse(sample.job);
  const [profile, styleGuidance, context] = await Promise.all([
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
    messageContext(env, userId, job, sample.shape),
  ]);
  return prepareApplicationMessageRevision(
    job,
    profile,
    input.currentMessage,
    input.instruction,
    styleGuidance,
    context
  );
}

export async function completeMessagePreviewTask(
  env: AppEnv,
  userId: string,
  input: MessagePreviewTaskInput,
  rawOutput: unknown,
  modelId: string
) {
  const prepared = await prepareMessagePreviewTask(env, userId, input);
  const revised = validateGeneratedApplicationMessage(
    rawOutput,
    prepared,
    modelId
  );
  return {
    changeSummary: revised.summary,
    message: revised.message,
    modelId: revised.modelId,
    previousMessage: input.currentMessage,
    provider: revised.provider,
  };
}

function requirePreviewSample(key: string) {
  const sample = PREVIEW_SAMPLES.find((candidate) => candidate.key === key);
  if (!sample) {
    throw new Error("Unknown message preview sample");
  }
  return sample;
}

function startingMessage(
  job: JobImport,
  profile: Awaited<ReturnType<typeof savedProfile>>,
  context: Awaited<ReturnType<typeof messageContext>>
) {
  const route = job.messageRoute;
  const policy = applicationMessagePolicyFor(
    route,
    context.approvedTemplate,
    new Date(),
    context.timeZone
  );
  const question =
    policy.requiredQuestion ??
    (route === "school_outreach"
      ? "Are you currently hiring English teachers?"
      : "Which locations and student groups are you currently recruiting for?");
  return `${openingFor(job.contactName)}\n\nI am writing to express my interest in the ${job.title} position. My background aligns with your requirements, and I am passionate about helping students achieve their goals.\n\n${question}\n\nBest,\n${signatureFor(profile)}`;
}
