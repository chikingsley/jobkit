import { z } from "zod";
import type { Preferences } from "../preferences/schema";
import {
  DegreeLevelSchema,
  type Profile,
  WorkExperienceEntrySchema,
} from "../profile/schema";

const WHITESPACE_PATTERN = /\s+/u;

export const ExtractionConfidenceSchema = z.enum(["high", "medium", "low"]);

const supportedText = (maximum: number) =>
  z
    .object({
      confidence: ExtractionConfidenceSchema,
      evidence: z.string().max(800),
      value: z.string().max(maximum),
    })
    .strict();

export const ImportedEducationSchema = z
  .object({
    confidence: ExtractionConfidenceSchema,
    country: z.string().max(120),
    degree: z.string().max(160),
    evidence: z.string().max(1200),
    field: z.string().max(160),
    institution: z.string().max(220),
    level: DegreeLevelSchema,
  })
  .strict();

export const ImportedLanguageSchema = z
  .object({
    confidence: ExtractionConfidenceSchema,
    evidence: z.string().max(800),
    language: z.string().max(100),
    level: z.enum([
      "unspecified",
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
      "C2",
      "native",
    ]),
  })
  .strict();

export const ImportedListItemSchema = z
  .object({
    confidence: ExtractionConfidenceSchema,
    evidence: z.string().max(800),
    value: z.string().max(180),
  })
  .strict();

export const ImportedWorkExperienceSchema = WorkExperienceEntrySchema.extend({
  confidence: ExtractionConfidenceSchema,
  evidence: z.string().max(1600),
}).strict();

export const ProfileImportProposalSchema = z
  .object({
    citizenship: supportedText(120),
    credentials: z.array(ImportedListItemSchema).max(30),
    currentLocation: supportedText(180),
    education: z.array(ImportedEducationSchema).max(20),
    email: supportedText(320),
    experienceLabel: supportedText(120),
    fullName: supportedText(180),
    introduction: supportedText(3000),
    languages: z.array(ImportedLanguageSchema).max(20),
    phone: supportedText(80),
    reviewNotes: z.array(z.string().max(300)).max(30),
    skills: z.array(ImportedListItemSchema).max(60),
    workExperience: z.array(ImportedWorkExperienceSchema).max(80),
  })
  .strict();

export type ProfileImportProposal = z.infer<typeof ProfileImportProposalSchema>;

export const ProfileImportStatusSchema = z.enum([
  "processing",
  "ready",
  "failed",
  "applied",
]);

export interface ProfileImportResult {
  id: string;
  profile: Profile;
  proposal: ProfileImportProposal;
  status: z.infer<typeof ProfileImportStatusSchema>;
}

export interface OnboardingState {
  completedAt: string | null;
  hasPreferences: boolean;
  hasProfile: boolean;
  preferences: Preferences;
  profile: Profile;
  profileImport: {
    errorMessage: string | null;
    id: string;
    proposal: ProfileImportProposal | null;
    status: z.infer<typeof ProfileImportStatusSchema>;
  } | null;
}

export function profileFromImport(
  proposal: ProfileImportProposal,
  account: { email: string; name: string }
): Profile {
  const fullName = proposal.fullName.value.trim() || account.name;
  const suggestedPhone = proposal.phone.value.trim();
  const phone = z.e164().safeParse(suggestedPhone).success
    ? suggestedPhone
    : "";
  const reviewNotes = [...proposal.reviewNotes];
  if (suggestedPhone && !phone) {
    reviewNotes.push(
      "Confirm the phone number and international country code."
    );
  }
  for (const language of proposal.languages) {
    if (language.level === "unspecified") {
      reviewNotes.push(`Choose a proficiency level for ${language.language}.`);
    }
  }

  return {
    availability: "",
    citizenship: proposal.citizenship.value.trim(),
    credentials: uniqueValues(
      proposal.credentials.map((credential) => credential.value)
    ),
    currentLocation: proposal.currentLocation.value.trim(),
    education: proposal.education.map((entry) => ({
      country: entry.country.trim(),
      degree: entry.degree.trim(),
      field: entry.field.trim(),
      institution: entry.institution.trim(),
      level: entry.level,
    })),
    email: z.email().safeParse(proposal.email.value.trim()).success
      ? proposal.email.value.trim()
      : account.email,
    experienceLabel: proposal.experienceLabel.value.trim(),
    fields: uniqueValues(proposal.skills.map((skill) => skill.value)),
    fullName,
    introduction: proposal.introduction.value.trim(),
    languages: proposal.languages.flatMap((language) =>
      language.level === "unspecified"
        ? []
        : [{ language: language.language.trim(), level: language.level }]
    ),
    phone,
    preferredName: fullName.split(WHITESPACE_PATTERN)[0] ?? fullName,
    profileReviewNotes: uniqueValues(reviewNotes).slice(0, 20),
    workAuthorization: [],
    workExperience: proposal.workExperience.map((entry) => ({
      current: entry.current,
      employer: entry.employer.trim(),
      endDate: entry.endDate.trim(),
      highlights: uniqueValues(entry.highlights),
      location: entry.location.trim(),
      startDate: entry.startDate.trim(),
      title: entry.title.trim(),
    })),
  };
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
