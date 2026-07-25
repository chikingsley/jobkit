import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  ApplicationMessageTaskOutputSchema,
} from "../../src/agent-tasks/application-message";
import type { Preferences } from "../../src/features/preferences/schema";
import type { Profile } from "../../src/features/profile/schema";
import { type ProviderName, resolveAssignment } from "../../src/model/registry";
import type { MessageExemplar } from "../repositories/message-exemplars";
import type { ActiveMessageFoundation } from "../repositories/message-foundations";
import type { ApplicationMessageRoute, JobImport } from "../schemas";
import {
  applicationMessagePolicyFor,
  type MessageShape,
  validateApplicationMessage,
} from "./application-message-policy";

const WHITESPACE_PATTERN = /\s+/u;
const TRAILING_COMMA_PATTERN = /,$/u;
const TRAILING_PERIOD_PATTERN = /\.$/u;

export interface GeneratedApplicationMessage
  extends ReturnType<typeof ApplicationMessageTaskOutputSchema.parse> {
  modelId: string;
  provider: ProviderName;
}

export interface MessageContext extends ActiveMessageFoundation {
  exemplars?: MessageExemplar[];
  now?: Date;
  preferences?: Preferences | null;
  requiredPositionReferences?: string[];
  requiredQuestion?: string;
  shape?: MessageShape;
  timeZone: string;
}

export interface PreparedApplicationMessage {
  input: Record<string, unknown> & {
    messageRoute: ApplicationMessageRoute;
    requiredEnding: string;
    requiredOpening: string;
    requiredPositionReferences: string[];
    requiredQuestion?: string | null;
  };
}

export function prepareApplicationMessageGeneration(
  job: JobImport,
  profile: Profile,
  styleGuidance: string[],
  context: MessageContext
): PreparedApplicationMessage {
  const signature = signatureFor(profile);
  const requiredOpening = openingFor(job.contactName);
  const messageRoute = messageRouteFor(job);
  const policy = applicationMessagePolicyFor(
    messageRoute,
    context.approvedTemplate,
    context.now ?? new Date(),
    context.timeZone
  );
  const requiredQuestion = context.requiredQuestion ?? policy.requiredQuestion;
  return {
    input: {
      approvedTemplate: policy.approvedTemplate,
      candidatePreferences: messagePreferences(context.preferences),
      candidateProfile: messageProfile(profile),
      job,
      messageRoute,
      provenExamples: exemplarPrompts(context.exemplars),
      questionGuidance: policy.questionGuidance,
      request: "Write a new application message.",
      requiredEnding: `Best,\n${signature}`,
      requiredOpening,
      requiredPositionReferences: context.requiredPositionReferences ?? [],
      requiredQuestion,
      styleGuidance: [...context.voiceRules, ...styleGuidance],
    },
  };
}

export function prepareApplicationMessageRevision(
  job: JobImport,
  profile: Profile,
  currentMessage: string,
  revisionInstruction: string,
  styleGuidance: string[],
  context: MessageContext
): PreparedApplicationMessage {
  const signature = signatureFor(profile);
  const requiredOpening = openingFor(job.contactName);
  const messageRoute = messageRouteFor(job);
  const policy = applicationMessagePolicyFor(
    messageRoute,
    context.approvedTemplate,
    context.now ?? new Date(),
    context.timeZone
  );
  const requiredQuestion = context.requiredQuestion ?? policy.requiredQuestion;
  return {
    input: {
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
      requiredOpening,
      requiredPositionReferences: context.requiredPositionReferences ?? [],
      requiredQuestion,
      revisionInstruction,
      styleGuidance: [...context.voiceRules, ...styleGuidance],
    },
  };
}

export function validateGeneratedApplicationMessage(
  rawOutput: unknown,
  prepared: PreparedApplicationMessage,
  modelId: string
): GeneratedApplicationMessage {
  const output = ApplicationMessageTaskOutputSchema.parse(rawOutput);
  const message = validateApplicationMessage(
    output.message,
    prepared.input.requiredOpening,
    prepared.input.requiredEnding,
    prepared.input.messageRoute,
    prepared.input.requiredQuestion
  );
  validateRequiredPositionReferences(
    message,
    prepared.input.requiredPositionReferences
  );
  return {
    guidance: output.guidance,
    message,
    modelId,
    provider: resolveAssignment(APPLICATION_MESSAGE_TASK_TYPE).provider,
    summary: output.summary.trim(),
  };
}

function validateRequiredPositionReferences(
  message: string,
  references: string[]
) {
  const missing = references.filter(
    (reference) => !message.includes(reference)
  );
  if (missing.length > 0) {
    throw new Error(
      `message must include every selected position ID; missing ${missing.join(", ")}`
    );
  }
}

export function messageRouteFor(job: JobImport): ApplicationMessageRoute {
  return job.opportunityScope === "multi_position"
    ? "multi_position"
    : job.messageRoute;
}

export function messageProfile(profile: Profile) {
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
    workExperience: profile.workExperience.map((entry) => ({
      current: entry.current,
      endDate: entry.endDate,
      highlights: entry.messageHighlights,
      location: entry.location,
      organization:
        entry.messageAttribution === "name" ? entry.employer : undefined,
      startDate: entry.startDate,
      title: entry.title,
    })),
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

export function signatureFor(profile: Profile): string {
  const surname =
    profile.fullName.trim().split(WHITESPACE_PATTERN).at(-1) ?? "";
  const lines = [`${profile.preferredName} ${surname}`.trim()];
  const phone = formattedPhone(profile.phone);
  if (phone) {
    lines.push(`M: ${phone}`);
  }
  if (profile.email.trim()) {
    lines.push(`E: ${profile.email.trim()}`);
  }
  return lines.join("\n");
}

function formattedPhone(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  const phone = parsePhoneNumberFromString(raw);
  if (!phone) {
    return raw;
  }
  if (phone.countryCallingCode === "1") {
    return `+1 ${phone.formatNational()}`;
  }
  return phone.formatInternational();
}

const HONORIFICS = new Map([
  ["dr", "Dr."],
  ["miss", "Miss"],
  ["mr", "Mr."],
  ["mrs", "Mrs."],
  ["ms", "Ms."],
  ["prof", "Prof."],
]);

export function openingFor(contactName: string) {
  const parts = contactName.trim().split(WHITESPACE_PATTERN).filter(Boolean);
  const [first] = parts;
  if (!first) {
    return "Hello,";
  }
  const honorificKey = first.replace(TRAILING_PERIOD_PATTERN, "").toLowerCase();
  const honorific = HONORIFICS.get(honorificKey);
  if (honorific && parts.length > 1) {
    return `Hello ${honorific} ${parts.at(-1)},`;
  }
  return `Hello ${first.replace(TRAILING_COMMA_PATTERN, "")},`;
}
