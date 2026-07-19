import { applicationMessagePolicyFor } from "../ai/application-message-policy";
import {
  openingFor,
  reviseApplicationMessage,
  signatureFor,
} from "../ai/application-messages";
import type { AppEnv } from "../env";
import { readApplicationMessageModel } from "../repositories/ai-model-settings";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { type JobImport, JobImportSchema } from "../schemas";
import { messageContext, savedProfile } from "./application-drafts";

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

export async function reviseMessagePreview(
  env: AppEnv,
  userId: string,
  key: string,
  currentMessage: string,
  instruction: string
) {
  const sample = PREVIEW_SAMPLES.find((candidate) => candidate.key === key);
  if (!sample) {
    throw new Error("Unknown message preview sample");
  }
  const job = JobImportSchema.parse(sample.job);
  const [model, profile, styleGuidance, context] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
    messageContext(env, userId, job, sample.shape),
  ]);
  return reviseApplicationMessage(
    env,
    model,
    job,
    profile,
    currentMessage,
    instruction,
    styleGuidance,
    context
  );
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
