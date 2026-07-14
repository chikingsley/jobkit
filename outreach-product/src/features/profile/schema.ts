import { z } from "zod";

export const PROFILE_SCHEMA_VERSION = 2;

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
  })
  .strict();

export const defaultProfile: Profile = {
  availability: "immediately",
  citizenship: "United States",
  credentials: [
    "240-hour TEFL Certificate",
    "Arizona Standard Adult Education Certificate",
    "Arizona Substitute Certificate, PreK-12",
    "Arizona Subject Matter Expert Certificate, 6-12 Chemistry",
  ],
  currentLocation: "Scottsdale, Arizona, United States",
  education: [
    {
      country: "United States",
      degree: "Bachelor of Science",
      field: "Chemical Engineering",
      institution: "West Virginia University",
      level: "bachelor",
    },
  ],
  email: "chibuzor.ejimofor@gmail.com",
  experienceLabel: "More than five years",
  fields: [
    "English / ESL",
    "Adult education",
    "Biology",
    "Chemistry / science",
    "College learners",
    "Children and teenagers",
    "Online instruction",
  ],
  fullName: "Chibuzor Ejimofor",
  introduction:
    "TEFL-certified educator with experience teaching adult learners, children, teenagers, and mixed-proficiency classes in the United States and Russia. Background includes biology teaching assistance, youth coaching, technical training, and cross-cultural communication.",
  languages: [{ language: "English", level: "native" }],
  phone: "+13042168700",
  preferredName: "Simon",
  profileReviewNotes: [
    "Confirm whether the public experience label should be 5+ or 7+ years.",
    "Add references only after confirming current contact details and consent.",
  ],
  workAuthorization: [
    { country: "United States", expiresAt: "", status: "citizen" },
  ],
};
