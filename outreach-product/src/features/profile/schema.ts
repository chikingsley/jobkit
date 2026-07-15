import { z } from "zod";

export const PROFILE_SCHEMA_VERSION = 3;

export const DegreeLevelSchema = z.enum([
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "certificate",
  "diploma",
  "other",
]);

export type DegreeLevel = z.infer<typeof DegreeLevelSchema>;

export interface EducationEntry {
  country: string;
  degree: string;
  field: string;
  institution: string;
  level: DegreeLevel;
}

export interface LanguageEntry {
  language: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "native";
}

export interface WorkAuthorizationEntry {
  country: string;
  expiresAt: string;
  status:
    | "citizen"
    | "permanent-resident"
    | "temporary-resident"
    | "work-permit"
    | "other";
}

export interface WorkExperienceEntry {
  current: boolean;
  employer: string;
  endDate: string;
  highlights: string[];
  location: string;
  startDate: string;
  title: string;
}

export interface Profile {
  availability: string;
  citizenship: string;
  credentials: string[];
  currentLocation: string;
  education: EducationEntry[];
  email: string;
  experienceLabel: string;
  fields: string[];
  fullName: string;
  introduction: string;
  languages: LanguageEntry[];
  phone: string;
  preferredName: string;
  profileReviewNotes: string[];
  workAuthorization: WorkAuthorizationEntry[];
  workExperience: WorkExperienceEntry[];
}

export const EducationEntrySchema: z.ZodType<EducationEntry> = z
  .object({
    country: z.string().max(120),
    degree: z.string().min(1, "Enter the degree name").max(160),
    field: z.string().max(160),
    institution: z.string().min(1, "Enter the institution").max(220),
    level: DegreeLevelSchema,
  })
  .strict();

export const LanguageEntrySchema: z.ZodType<LanguageEntry> = z
  .object({
    language: z.string().min(1, "Choose a language").max(100),
    level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
  })
  .strict();

export const WorkAuthorizationEntrySchema: z.ZodType<WorkAuthorizationEntry> = z
  .object({
    country: z.string().min(1, "Choose a country").max(120),
    expiresAt: z.union([z.literal(""), z.iso.date()]),
    status: z.enum([
      "citizen",
      "permanent-resident",
      "temporary-resident",
      "work-permit",
      "other",
    ]),
  })
  .strict();

export const WorkExperienceEntrySchema = z
  .object({
    current: z.boolean(),
    employer: z.string().min(1, "Enter the employer").max(180),
    endDate: z.string().max(40),
    highlights: z.array(z.string().min(1).max(500)).max(30),
    location: z.string().max(180),
    startDate: z.string().max(40),
    title: z.string().min(1, "Enter the role").max(180),
  })
  .strict() satisfies z.ZodType<WorkExperienceEntry>;

export const ProfileSchema: z.ZodType<Profile> = z
  .object({
    availability: z.string().max(120),
    citizenship: z.string().min(1, "Choose a citizenship").max(120),
    credentials: z.array(z.string().max(180)).max(30),
    currentLocation: z.string().min(1, "Enter a current location").max(180),
    education: z.array(EducationEntrySchema).max(20),
    email: z.email("Enter a valid email address"),
    experienceLabel: z.string().max(120),
    fields: z.array(z.string().max(100)).max(30),
    fullName: z.string().min(1, "Enter a full legal name").max(180),
    introduction: z.string().max(3000),
    languages: z.array(LanguageEntrySchema).max(20),
    phone: z.union([
      z.literal(""),
      z.e164("Enter a valid international phone number"),
    ]),
    preferredName: z.string().min(1, "Enter a preferred name").max(100),
    profileReviewNotes: z.array(z.string().max(240)).max(20),
    workAuthorization: z.array(WorkAuthorizationEntrySchema).max(30),
    workExperience: z.array(WorkExperienceEntrySchema).max(80),
  })
  .strict();

export const defaultProfile: Profile = {
  availability: "",
  citizenship: "",
  credentials: [],
  currentLocation: "",
  education: [],
  email: "",
  experienceLabel: "",
  fields: [],
  fullName: "",
  introduction: "",
  languages: [],
  phone: "",
  preferredName: "",
  profileReviewNotes: [],
  workAuthorization: [],
  workExperience: [],
};
